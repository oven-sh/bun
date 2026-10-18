use super::findings::ObjectOrigin;
use super::flows::{ExternalMark, Place};
use super::identity::Identity;
use crate::atom::Atom;
use crate::bind::{Decl, FnOwner, Parent, PatParent, ScopeId, SymFlags};
use crate::check::{Checker, CompilerDiagnostic, ContextFlags};
use crate::hir::{BinOp, ClassId, ExprId, ExprKind, ExprTag, FileKind, Flags, FnBody, FnId, PatId, PatKind, PropKey, StmtKind, TypeNodeId};
use crate::program::FileId;
use crate::types::{PropSource, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use std::cell::Cell;

const MAX_STEPS: usize = 32;
const MAX_SOURCES_FOLLOWED: u32 = 6;
const MAX_SOURCES_SEARCHED: u32 = 64;
const MAX_PARENTS_SEARCHED: u32 = 4;
const MAX_TYPE_ARGUMENTS_FOLLOWED: u32 = 3;
const MAX_SUGGESTED_TYPE_LENGTH: usize = 80;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Derivation {
    Property(Atom),
    Element,
    Other,
}

pub struct UntypedOrigin {
    pub root: CompilerDiagnostic,
    pub annotation: Option<(u32, u32)>,
    pub parsed_by: Option<(u32, u32)>,
    pub asserted: Option<Assertion>,
    pub parameter: Option<(FnId, u32)>,
    pub derivation: Vec<Derivation>,
}

pub struct Assertion {
    pub written_type: Vec<u8>,
    pub cast: Option<(u32, u32)>,
}

pub enum MissingLayout {
    UntypedValue(Box<UntypedOrigin>),
    Reasons(Vec<CompilerDiagnostic>),
    Package { declared_in: FileId, given_at: Place },
}

enum Step {
    Continue(FileId, ExprId),
    Root(Box<UntypedOrigin>),
}

impl Step {
    fn at_root(origin: UntypedOrigin) -> Step {
        Step::Root(Box::new(origin))
    }
}

struct Known<'a> {
    marks: &'a FxHashMap<Identity, ExternalMark>,
    classes_without_layout: &'a FxHashSet<(FileId, ClassId)>,
    asked_about: Option<Place>,
    sources_left: Cell<u32>,
}

#[derive(Default)]
pub struct Explaining {
    marks: FxHashMap<Identity, ExternalMark>,
    exprs_by_position: FxHashMap<FileId, Vec<(u32, ExprId)>>,
    patterns_by_position: FxHashMap<FileId, Vec<(u32, PatId)>>,
}

fn starting_at<Id: Copy>(sorted: &[(u32, Id)], pos: u32) -> Vec<Id> {
    let first = sorted.partition_point(|node| node.0 < pos);
    sorted[first..].iter().take_while(|node| node.0 == pos).map(|node| node.1).collect()
}

impl<'p, 's> Checker<'p, 's> {
    fn holds_untyped_value(&mut self, file: FileId, e: ExprId) -> bool {
        let ty = self.type_of_expr(file, e);
        self.is_any_or_unknown(ty)
    }

    fn is_any_or_unknown(&self, ty: TypeId) -> bool {
        ty != TypeId::UNRESOLVED
            && self.parts(ty).iter().any(|&part| match self.data(part) {
                TypeData::Ref { args, .. } if self.is_array(part) => args.actual().is_some_and(|elements| elements.iter().any(|&element| self.is_any_or_unknown(element))),
                _ => part.is_any() || part == TypeId::UNKNOWN,
            })
    }

    fn untyped_root(&self, at: Place, end: u32, code: u32, args: Vec<Vec<u8>>) -> UntypedOrigin {
        let found = self.finding_at(at, code, args);
        UntypedOrigin { root: CompilerDiagnostic { end: if end > at.pos { end } else { found.end }, ..found }, annotation: None, parsed_by: None, asserted: None, parameter: None, derivation: Vec::new() }
    }

    fn written_text(&self, file: FileId, start: u32, end: u32) -> Vec<u8> {
        const MAX_SHOWN: usize = 48;
        let text = &self.hir(file).text;
        let written = &text[(start as usize).min(text.len())..(end as usize).min(text.len())];
        let line = written.split(|&byte| byte == b'\n').next().unwrap_or(written);
        if line.len() == written.len() && line.len() <= MAX_SHOWN {
            return line.to_vec();
        }
        let mut shown = line.len().min(MAX_SHOWN);
        while shown > 0 && line[shown - 1] & 0xC0 == 0x80 {
            shown -= 1;
        }
        [&line[..shown], b".."].concat()
    }

    fn json_parse_call(&mut self, file: FileId, mut e: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Await(expr) = hir[e].kind {
            e = expr;
        }
        let ExprKind::Call(call) = hir[e].kind else { return None };
        let ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind else { return None };
        (self.atoms().bytes(name) == b"parse" && hir[call].type_args.len == 0 && self.refers_to_global_object(file, obj, b"JSON")).then_some(e)
    }

    fn json_parse_root(&mut self, file: FileId, call: ExprId) -> UntypedOrigin {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let callee_end = match hir[call].kind {
            ExprKind::Call(called) => hir[hir[called].callee].end,
            _ => hir[call].end,
        };
        let asserted = match bound.expr_parent[call.idx()] {
            Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                ExprKind::As { ty, .. } => Some((ty, Some((hir[call].end, hir[parent].end)))),
                _ => None,
            },
            Parent::VarInit(d) if hir[d].ty.is_some() => Some((hir[d].ty, None)),
            _ => None,
        };
        let asserted = asserted.filter(|&(ty, _)| {
            let asserted = self.type_from_node(file, ty);
            !self.is_any_or_unknown(asserted)
        });
        let asserted = asserted.map(|(ty, cast)| Assertion { written_type: hir.text[hir[ty].pos as usize..hir[ty].end as usize].to_vec(), cast });
        UntypedOrigin { parsed_by: Some((hir[call].pos, callee_end)), asserted, ..self.untyped_root(Place { file, pos: hir[call].pos }, callee_end, 100094, Vec::new()) }
    }

    fn annotated_root(&mut self, file: FileId, name: Vec<u8>, annotation: TypeNodeId, initializer: ExprId, code: u32) -> UntypedOrigin {
        let node = self.hir(file)[annotation];
        if initializer.is_some()
            && let Some(call) = self.json_parse_call(file, initializer)
        {
            return UntypedOrigin { annotation: Some((node.pos, node.end)), ..self.json_parse_root(file, call) };
        }
        let written = self.written_text(file, node.pos, node.end);
        UntypedOrigin { annotation: Some((node.pos, node.end)), ..self.untyped_root(Place { file, pos: node.pos }, node.end, code, vec![name, written]) }
    }

    fn step_from_pattern(&mut self, file: FileId, pat: PatId, derivation: &mut Vec<Derivation>) -> Step {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let name = match hir[pat].kind {
            PatKind::Ident(name) => self.atoms().bytes(name).to_vec(),
            _ => Vec::new(),
        };
        let mut outer = pat;
        let declared_by = loop {
            match bound.pat_parent[outer.idx()] {
                PatParent::Prop(parent, prop) => {
                    derivation.push(match (hir[prop].key, hir[hir[prop].value].kind) {
                        (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) if !hir[prop].is_rest => Derivation::Property(name),
                        _ => Derivation::Other,
                    });
                    outer = parent;
                }
                PatParent::Elem(parent, _) => {
                    derivation.push(Derivation::Element);
                    outer = parent;
                }
                other => break other,
            }
        };
        let here = Place { file, pos: hir[pat].pos };
        match declared_by {
            PatParent::Var(d) if hir[d].ty.is_some() => Step::at_root(self.annotated_root(file, name, hir[d].ty, hir[d].init, 100092)),
            PatParent::Var(d) if hir[d].init.is_some() => Step::Continue(file, hir[d].init),
            PatParent::Var(d) => {
                let iterable = self.loop_variable_iterable(file, d);
                if iterable.is_some() {
                    derivation.push(Derivation::Element);
                    return Step::Continue(file, iterable);
                }
                Step::at_root(self.untyped_root(here, 0, 100093, vec![name]))
            }
            PatParent::Param(p) if hir[p].ty.is_some() => {
                let function = bound.param_fn[p.idx()];
                let index = hir[function].params.iter().position(|parameter| parameter == p).filter(|_| outer == pat);
                Step::at_root(UntypedOrigin { parameter: index.map(|index| (function, index as u32)), ..self.annotated_root(file, name, hir[p].ty, ExprId::NONE, 100092) })
            }
            PatParent::Param(p) => {
                let function = bound.param_fn[p.idx()];
                if let FnOwner::Expr(callback) = bound.fns[function.idx()].owner
                    && let Parent::Expr(taker) = bound.expr_parent[callback.idx()]
                    && taker.is_some()
                    && let ExprKind::Call(call) = hir[taker].kind
                    && hir.ids(hir[call].args).any(|argument| argument == callback)
                    && self.holds_untyped_value(file, hir[call].callee)
                {
                    derivation.push(Derivation::Other);
                    return Step::Continue(file, hir[call].callee);
                }
                let index = hir[function].params.iter().position(|parameter| parameter == p).filter(|_| outer == pat);
                Step::at_root(UntypedOrigin { parameter: index.map(|index| (function, index as u32)), ..self.untyped_root(here, 0, 100093, vec![name]) })
            }
            _ => Step::at_root(self.untyped_root(here, 0, 100093, vec![name])),
        }
    }

    fn step_from_property(&mut self, file: FileId, e: ExprId, holder: TypeId, name: Atom) -> Option<UntypedOrigin> {
        let (prop, _) = self.get_property_of_type(holder, name)?;
        let &PropSource::Symbol(sym) = &prop.source else { return None };
        let (declared_in, declared) = self.files().value_declaration(sym)?;
        let hir = self.hir(declared_in);
        let shown = self.atoms().bytes(name).to_vec();
        if self.is_declaration_only(declared_in) || self.is_untyped_file(declared_in) {
            let read = self.hir(file)[e];
            let written = self.written_text(file, read.pos, read.end);
            let ty = self.type_of_expr(file, e);
            let ty = self.display_name(ty).into_bytes();
            return Some(self.untyped_root(Place { file, pos: read.pos }, read.end, 100100, vec![written, ty]));
        }
        match declared {
            Decl::Member(member) if hir[member].ty.is_some() => Some(self.annotated_root(declared_in, shown, hir[member].ty, ExprId::NONE, 100092)),
            Decl::Member(member) => Some(self.untyped_root(Place { file: declared_in, pos: hir[member].name_pos }, 0, 100093, vec![shown])),
            Decl::ParameterProperty(parameter) if hir[parameter].ty.is_some() => Some(self.annotated_root(declared_in, shown, hir[parameter].ty, ExprId::NONE, 100092)),
            _ => None,
        }
    }

    fn step_from_call(&mut self, file: FileId, e: ExprId, callee: ExprId, derivation: &mut Vec<Derivation>) -> Step {
        let hir = self.hir(file);
        let (at, callee_end) = (Place { file, pos: hir[e].pos }, hir[callee].end);
        if let Some(call) = self.json_parse_call(file, e) {
            return Step::at_root(self.json_parse_root(file, call));
        }
        if self.is_object_create(file, e) {
            return Step::at_root(match self.why_object_create_makes_no_record(file, e) {
                Some(why) => self.untyped_root(at, callee_end, 100091, vec![why.as_bytes().to_vec()]),
                None => self.untyped_root(at, callee_end, 100105, Vec::new()),
            });
        }
        if self.holds_untyped_value(file, callee) {
            derivation.push(Derivation::Other);
            return Step::Continue(file, callee);
        }
        if let ExprKind::Call(call) = hir[e].kind
            && let Some(returned) = hir.ids(hir[call].args).next()
            && (self.is_object_assign(file, e) || self.is_identity_call(file, e))
            && self.holds_untyped_value(file, returned)
        {
            return Step::Continue(file, returned);
        }
        let written = self.written_text(file, hir[callee].pos, callee_end);
        let result = self.type_of_expr(file, e);
        let result = self.display_name(result).into_bytes();
        let Some((declared_in, function, _)) = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)) else {
            return Step::at_root(self.untyped_root(at, callee_end, 100095, vec![written, result]));
        };
        if self.is_declaration_only(declared_in) || self.is_untyped_file(declared_in) {
            return Step::at_root(self.untyped_root(at, callee_end, 100095, vec![written, result]));
        }
        let (declaring, bound) = (self.hir(declared_in), self.bound(declared_in));
        let called = &declaring[function];
        if called.ret.is_some() {
            let name = if called.name.is_some() { self.atoms().bytes(called.name).to_vec() } else { written };
            return Step::at_root(self.annotated_root(declared_in, name, called.ret, ExprId::NONE, 100096));
        }
        let returned: Vec<ExprId> = match called.body {
            FnBody::Expr(body) => vec![body],
            _ => (bound.ids(bound.fns[function.idx()].returns))
                .filter_map(|statement| match declaring[statement].kind {
                    StmtKind::Return(value) if value.is_some() => Some(value),
                    _ => None,
                })
                .collect(),
        };
        for value in returned {
            self.prepare_enclosing(declared_in, value);
            if self.holds_untyped_value(declared_in, value) {
                return Step::Continue(declared_in, value);
            }
        }
        Step::at_root(self.untyped_root(at, callee_end, 100095, vec![written, result]))
    }

    fn step_towards_untyped_origin(&mut self, file: FileId, e: ExprId, derivation: &mut Vec<Derivation>) -> Step {
        let hir = self.hir(file);
        let here = Place { file, pos: hir[e].pos };
        match hir[e].kind {
            ExprKind::As { expr, ty } => {
                let target = self.type_from_node(file, ty);
                if self.is_any_or_unknown(target) && !self.holds_untyped_value(file, expr) {
                    let (node, written) = (hir[ty], self.written_text(file, hir[expr].pos, hir[expr].end));
                    let target = self.written_text(file, node.pos, node.end);
                    return Step::at_root(UntypedOrigin { annotation: Some((node.pos, node.end)), ..self.untyped_root(Place { file, pos: node.pos }, node.end, 100097, vec![written, target]) });
                }
                Step::Continue(file, expr)
            }
            ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) | ExprKind::Await(expr) => Step::Continue(file, expr),
            ExprKind::Assign { value, .. } => Step::Continue(file, value),
            ExprKind::Cond { yes, no, .. } => Step::Continue(file, if self.holds_untyped_value(file, yes) { yes } else { no }),
            ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, left, right } => Step::Continue(file, if self.holds_untyped_value(file, left) { left } else { right }),
            ExprKind::Binary { op: BinOp::And | BinOp::Comma, right, .. } => Step::Continue(file, right),
            ExprKind::Dot { obj, name, .. } => {
                if self.holds_untyped_value(file, obj) {
                    derivation.push(Derivation::Property(name));
                    return Step::Continue(file, obj);
                }
                let holder = self.type_of_expr(file, obj);
                match self.step_from_property(file, e, holder, name) {
                    Some(root) => Step::at_root(root),
                    None => Step::at_root(self.untyped_root(here, hir[e].end, 100075, vec![b"any".to_vec()])),
                }
            }
            ExprKind::Index { obj, .. } => {
                derivation.push(Derivation::Element);
                Step::Continue(file, obj)
            }
            ExprKind::Call(call) | ExprKind::New(call) => self.step_from_call(file, e, hir[call].callee, derivation),
            ExprKind::Ident(name) => {
                let named = self.symbol_of_identifier(file, e, name);
                let declared = named.and_then(|sym| self.files().resolve_alias_if_needed(sym).or(Some(sym))).and_then(|sym| self.files().value_declaration(sym));
                let shown = self.atoms().bytes(name).to_vec();
                match declared {
                    Some((of, Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat))) => self.step_from_pattern(of, pat, derivation),
                    Some((of, declared @ (Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_)))) => {
                        let import = match declared {
                            Decl::ImportSpec(named) => self.hir(of)[named].import,
                            Decl::ImportDefault(import) | Decl::ImportNamespace(import) => import,
                            _ => unreachable!(),
                        };
                        let specifier = self.hir(of)[import].spec;
                        Step::at_root(self.untyped_root(self.import_site(of, specifier), 0, 100099, vec![shown, self.atoms().bytes(specifier).to_vec()]))
                    }
                    _ => {
                        let ty = self.type_of_expr(file, e);
                        let ty = self.display_name(ty).into_bytes();
                        Step::at_root(self.untyped_root(here, hir[e].end, 100075, vec![ty]))
                    }
                }
            }
            _ => {
                let ty = self.type_of_expr(file, e);
                let ty = self.display_name(ty).into_bytes();
                Step::at_root(self.untyped_root(here, hir[e].end, 100075, vec![ty]))
            }
        }
    }

    pub fn is_caught_value(&mut self, file: FileId, mut e: ExprId) -> bool {
        let hir = self.hir(file);
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[e].kind {
            e = expr;
        }
        let ExprKind::Ident(name) = hir[e].kind else { return false };
        let Some((of, Decl::Var(pat))) = self.symbol_of_identifier(file, e, name).and_then(|sym| self.files().value_declaration(sym)) else { return false };
        let (declaring, bound) = (self.hir(of), self.bound(of));
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return false };
        let statement = bound.var_stmt[d.idx()];
        statement.is_some() && matches!(declaring[statement].kind, StmtKind::Try { param, .. } if param == d)
    }

    pub fn find_untyped_origin(&mut self, file: FileId, value: ExprId) -> UntypedOrigin {
        self.follow_to_untyped_origin(file, value, Vec::new())
    }

    pub fn find_untyped_origin_of_receiver(&mut self, file: FileId, receiver: ExprId, pattern: PatId) -> Option<UntypedOrigin> {
        if receiver.is_some() {
            self.prepare_enclosing(file, receiver);
            return self.holds_untyped_value(file, receiver).then(|| self.find_untyped_origin(file, receiver));
        }
        let destructured = self.type_of_pat(file, pattern);
        if !self.is_any_or_unknown(destructured) {
            return None;
        }
        let mut derivation = Vec::new();
        Some(match self.step_from_pattern(file, pattern, &mut derivation) {
            Step::Continue(file, source) => self.follow_to_untyped_origin(file, source, derivation),
            Step::Root(origin) => {
                derivation.reverse();
                UntypedOrigin { derivation, ..*origin }
            }
        })
    }

    pub fn span_of_expression(&self, file: FileId, e: ExprId) -> (u32, u32) {
        let node = self.hir(file)[e];
        (node.pos, node.end)
    }

    pub fn begin_explaining(&mut self) -> Explaining {
        Explaining { marks: self.external_marks().0, ..Explaining::default() }
    }

    fn exprs_starting_at(&self, explaining: &mut Explaining, file: FileId, pos: u32) -> Vec<ExprId> {
        let hir = self.hir(file);
        let sorted = explaining.exprs_by_position.entry(file).or_insert_with(|| {
            let mut sorted: Vec<(u32, ExprId)> = hir.exprs.iter().enumerate().map(|node| (node.1.pos, ExprId(node.0 as u32))).collect();
            sorted.sort_by_key(|&(pos, e)| (pos, std::cmp::Reverse(hir[e].end)));
            sorted
        });
        starting_at(sorted, pos)
    }

    fn patterns_starting_at(&self, explaining: &mut Explaining, file: FileId, pos: u32) -> Vec<PatId> {
        let hir = self.hir(file);
        let sorted = explaining.patterns_by_position.entry(file).or_insert_with(|| {
            let mut sorted: Vec<(u32, PatId)> = hir.pats.iter().enumerate().map(|node| (node.1.pos, PatId(node.0 as u32))).collect();
            sorted.sort_by_key(|node| node.0);
            sorted
        });
        starting_at(sorted, pos)
    }

    pub fn find_untyped_operand_at(&mut self, explaining: &mut Explaining, file: FileId, pos: u32) -> Option<ExprId> {
        let hir = self.hir(file);
        let mut starting_here = self.exprs_starting_at(explaining, file, pos);
        let (bound, mut around) = (self.bound(file), starting_here.first().copied());
        for _ in 0..MAX_PARENTS_SEARCHED {
            let Some(inner) = around else { break };
            around = match bound.expr_parent[inner.idx()] {
                Parent::Expr(parent) => Some(parent).filter(|parent| parent.is_some()),
                Parent::Prop(prop) => Some(bound.prop_owner[prop.idx()]),
                _ => None,
            };
            starting_here.extend(around);
        }
        for e in starting_here {
            self.prepare_enclosing(file, e);
            let operands: Vec<ExprId> = match hir[e].kind {
                ExprKind::Call(call) | ExprKind::New(call) => hir.ids(hir[call].args).collect(),
                ExprKind::Assign { value, .. } => vec![value],
                ExprKind::As { expr, .. } => vec![expr],
                ExprKind::Object(props) => props.iter().map(|prop| hir[prop].value).filter(|value| value.is_some()).collect(),
                _ => Vec::new(),
            };
            for operand in operands.into_iter().chain([e]) {
                let operand = match hir[operand].kind {
                    ExprKind::Spread(spread) => spread,
                    _ => operand,
                };
                if self.holds_untyped_value(file, operand) {
                    return Some(operand);
                }
            }
        }
        None
    }

    fn reasons_for_type_without_layout(&mut self, ty: TypeId, at: Place, known: &Known<'_>) -> Vec<CompilerDiagnostic> {
        let ty = self.reduced(ty);
        let mut parts = Vec::new();
        for part in self.parts(ty).to_vec() {
            match self.data(part) {
                TypeData::Intersection(constituents) => parts.extend(constituents.iter().copied()),
                _ => parts.push(part),
            }
        }
        let mut reasons = Vec::new();
        parts.retain(|&part| self.may_hold_objects(part) && !self.is_uninformative(part));
        for part in parts {
            let name = self.display_name(part).into_bytes();
            let identity = self.type_identity(part);
            let declared = self.type_declaration_site(part);
            let nearby = declared.unwrap_or(at);
            let is_of_runtime = declared.is_some_and(|declared| self.origin_of_declarations_in(declared.file) == ObjectOrigin::Runtime);
            if is_of_runtime && self.members(part).is_some_and(|members| !members.shape().index.is_empty() && members.shape().props.is_empty()) {
                reasons.push(self.finding_at(at, 100078, vec![name]));
                break;
            }
            if is_of_runtime {
                continue;
            }
            if let Some(resembled) = self.external_type_resembled_by(part) {
                reasons.push(self.finding_at(nearby, 100073, vec![name.clone(), known.marks.get(&resembled).map_or_else(Vec::new, |resembled| resembled.name.clone())]));
                reasons.extend(self.steps_to_external_source(known.marks, resembled, nearby));
            } else if self.is_tainted(part) && known.marks.contains_key(&identity) {
                reasons.extend(self.steps_to_external_source(known.marks, identity, nearby));
            }
            if known.asked_about.is_some_and(|asked_about| reasons.iter().any(|step| (step.file, step.start) == (asked_about.file, asked_about.pos))) {
                reasons.clear();
            }
            if !reasons.is_empty() {
                break;
            }
            if let Some(class) = self.class_for_type(part, false).filter(|class| known.classes_without_layout.contains(class)) {
                reasons.push(self.finding_at(self.class_site(class), 100085, vec![name]));
            } else if let Some(declared) = declared.filter(|declared| self.hir(declared.file).kind == FileKind::Declaration) {
                if self.origin_of_declarations_in(declared.file) == ObjectOrigin::Program {
                    reasons.push(self.finding_at(declared, 100102, vec![name]));
                }
            } else if let Some(declared) = declared.filter(|declared| self.is_untyped_file(declared.file) && self.origin_of_declarations_in(declared.file) == ObjectOrigin::Program) {
                let file_name = self.files().module(declared.file).file_name();
                reasons.push(self.finding_at(Place { file: declared.file, pos: 0 }, 100083, vec![file_name.rsplit(|&byte| byte == b'/').next().unwrap_or(file_name).to_vec()]));
            } else if matches!(self.data(part), TypeData::TypeParam(..)) {
                reasons.push(self.finding_at(at, 100079, vec![name]));
            } else if !self.is_array_or_tuple(part) && self.members(part).is_some_and(|members| !members.shape().index.is_empty()) {
                reasons.push(self.finding_at(nearby, 100078, vec![name]));
            }
            if !reasons.is_empty() {
                break;
            }
        }
        reasons
    }

    fn missing_layout_of_value(&mut self, file: FileId, e: ExprId, known: &Known<'_>) -> Option<MissingLayout> {
        self.prepare_enclosing(file, e);
        if self.holds_untyped_value(file, e) {
            return Some(MissingLayout::UntypedValue(Box::new(self.find_untyped_origin(file, e))));
        }
        let (ty, at) = (self.type_of_expr(file, e), Place { file, pos: self.hir(file)[e].pos });
        Some(self.reasons_for_type_without_layout(ty, at, known)).filter(|reasons| !reasons.is_empty()).map(MissingLayout::Reasons)
    }

    fn find_package_given(&mut self, file: FileId, handed_over: ExprId) -> Option<FileId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut around = handed_over;
        for _ in 0..MAX_STEPS {
            around = match bound.expr_parent[around.idx()] {
                Parent::Expr(parent) if parent.is_some() => parent,
                Parent::Prop(prop) => bound.prop_owner[prop.idx()],
                _ => return None,
            };
            match hir[around].kind {
                ExprKind::Call(_) | ExprKind::New(_) => {
                    self.prepare_enclosing(file, around);
                    let (declared_in, ..) = self.resolved_signature(file, around).sig.and_then(|sig| self.sig_decl(sig))?;
                    return (self.origin_of_declarations_in(declared_in) == ObjectOrigin::Package).then_some(declared_in);
                }
                ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::Cond { .. } => {}
                _ => return None,
            }
        }
        None
    }

    pub fn find_package_given_what_is_at(&mut self, explaining: &mut Explaining, file: FileId, pos: u32) -> Option<FileId> {
        self.exprs_starting_at(explaining, file, pos).into_iter().find_map(|e| self.find_package_given(file, e))
    }

    fn expected_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        self.prepare_enclosing(file, e);
        let expected = match self.bound(file).expr_parent[e.idx()] {
            Parent::Expr(parent) if parent.is_some() && matches!(self.hir(file)[parent].kind, ExprKind::As { .. }) => Some(self.type_of_expr(file, parent)),
            _ => self.contextual_type(file, e, ContextFlags::empty()),
        }?;
        Some(expected).filter(|&expected| !self.is_any_or_unknown(expected))
    }

    pub fn expected_type_text(&mut self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        let expected = self.expected_type(file, e)?;
        Some(self.type_to_string(expected)).filter(|text| text.len() <= MAX_SUGGESTED_TYPE_LENGTH)
    }

    fn collect_types_to_import(&mut self, ty: TypeId, into: FileId, depth: u32, found: &mut Vec<(Vec<u8>, FileId)>) {
        if depth > MAX_TYPE_ARGUMENTS_FOLLOWED {
            return;
        }
        for part in self.parts(ty).to_vec() {
            if let Some(element) = self.array_element(part) {
                self.collect_types_to_import(element, into, depth + 1, found);
                continue;
            }
            let named = match (self.alias_of_type(part), self.data(part)) {
                (Some((alias, _)), _) => Some(alias),
                (None, &TypeData::Ref { target, .. }) => Some(target),
                _ => None,
            };
            let Some(named) = named.filter(|named| named.file != into && self.origin_of_declarations_in(named.file) == ObjectOrigin::Program) else { continue };
            let name = self.files().symbol(named).name;
            if self.files().resolve_name(into, ScopeId(0), name, SymFlags::TYPE).is_none() {
                let import = (self.atoms().bytes(name).to_vec(), named.file);
                if !found.contains(&import) {
                    found.push(import);
                }
            }
        }
    }

    pub fn find_types_to_import(&mut self, into: FileId, file: FileId, e: ExprId) -> Vec<(Vec<u8>, FileId)> {
        let mut found = Vec::new();
        if let Some(expected) = self.expected_type(file, e) {
            self.collect_types_to_import(expected, into, 0, &mut found);
        }
        found
    }

    fn missing_layout_of_pattern_source(&mut self, file: FileId, pat: PatId, known: &Known<'_>, depth: u32) -> Option<MissingLayout> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut outer = pat;
        while let PatParent::Prop(parent, _) | PatParent::Elem(parent, _) = bound.pat_parent[outer.idx()] {
            outer = parent;
        }
        match bound.pat_parent[outer.idx()] {
            PatParent::Var(d) if hir[d].init.is_some() => self.missing_layout_among_sources(file, hir[d].init, known, depth + 1),
            PatParent::Var(d) => Some(self.loop_variable_iterable(file, d)).filter(|iterable| iterable.is_some()).and_then(|iterable| self.missing_layout_among_sources(file, iterable, known, depth + 1)),
            PatParent::Param(p) => {
                let FnOwner::Expr(callback) = bound.fns[bound.param_fn[p.idx()].idx()].owner else { return None };
                if hir[p].ty.is_some() || !matches!(hir[outer].kind, PatKind::Ident(_)) {
                    return match self.find_package_given(file, callback) {
                        Some(package) => Some(MissingLayout::Package { declared_in: package, given_at: Place { file, pos: hir[callback].pos } }),
                        None => self.missing_layout_of_what_calls(file, callback, known, depth),
                    };
                }
                let name = self.written_text(file, hir[outer].pos, hir[outer].end);
                let ty = self.type_of_pat(file, outer);
                let ty = self.display_name(ty).into_bytes();
                let is_async = hir[bound.param_fn[p.idx()]].flags.contains(Flags::ASYNC);
                let found = self.finding_at(Place { file, pos: hir[outer].pos }, if is_async { 100106 } else { 100103 }, vec![name, ty]);
                Some(MissingLayout::Reasons(vec![CompilerDiagnostic { end: hir[outer].end, ..found }]))
            }
            _ => None,
        }
    }

    fn is_global_of_the_library(&mut self, file: FileId, e: ExprId) -> bool {
        let ExprKind::Ident(name) = self.hir(file)[e].kind else { return false };
        let declared = self.symbol_of_identifier(file, e, name).and_then(|sym| self.files().value_declaration(sym));
        declared.is_some_and(|(declared_in, _)| self.files().module(declared_in).is_lib)
    }

    fn missing_layout_of_what_calls(&mut self, file: FileId, callback: ExprId, known: &Known<'_>, depth: u32) -> Option<MissingLayout> {
        let hir = self.hir(file);
        let Parent::Expr(taker) = self.bound(file).expr_parent[callback.idx()] else { return None };
        match taker.is_some().then(|| hir[taker].kind) {
            Some(ExprKind::Call(call)) if hir[call].callee != callback => self.missing_layout_among_sources(file, hir[call].callee, known, depth + 1),
            _ => None,
        }
    }

    fn missing_layout_among_sources(&mut self, file: FileId, e: ExprId, known: &Known<'_>, depth: u32) -> Option<MissingLayout> {
        if depth > MAX_SOURCES_FOLLOWED || known.sources_left.get() == 0 {
            return None;
        }
        known.sources_left.set(known.sources_left.get() - 1);
        if let ExprKind::Fn(_) = self.hir(file)[e].kind {
            return self.missing_layout_of_what_calls(file, e, known, depth);
        }
        if let Some(found) = self.missing_layout_of_value(file, e, known) {
            return Some(found);
        }
        let hir = self.hir(file);
        let called = match hir[e].kind {
            ExprKind::Call(_) | ExprKind::TaggedTemplate(_) => {
                self.prepare_enclosing(file, e);
                self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig))
            }
            _ => None,
        };
        if let Some((declared_in, function, _)) = called
            && !self.is_declaration_only(declared_in)
            && !self.is_untyped_file(declared_in)
        {
            let (declaring, bound) = (self.hir(declared_in), self.bound(declared_in));
            let returned: Vec<ExprId> = match declaring[function].body {
                FnBody::Expr(body) => vec![body],
                _ => (bound.ids(bound.fns[function.idx()].returns))
                    .filter_map(|statement| match declaring[statement].kind {
                        StmtKind::Return(value) if value.is_some() => Some(value),
                        _ => None,
                    })
                    .collect(),
            };
            if let Some(found) = returned.into_iter().find_map(|value| self.missing_layout_among_sources(declared_in, value, known, depth + 1)) {
                return Some(found);
            }
        }
        let sources: Vec<ExprId> = match hir[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) | ExprKind::Await(expr) | ExprKind::Spread(expr) => vec![expr],
            ExprKind::Dot { obj, .. } => vec![obj],
            ExprKind::Index { obj, index, .. } => vec![obj, index],
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => [hir[call].callee].into_iter().chain(hir.ids(hir[call].args)).collect(),
            ExprKind::Array(elements) => hir.ids(elements).filter(|element| element.is_some()).collect(),
            ExprKind::Cond { yes, no, .. } => vec![yes, no],
            ExprKind::Binary { left, right, .. } => vec![left, right],
            ExprKind::Assign { value, .. } => vec![value],
            ExprKind::Ident(name) => {
                let declared = self.symbol_of_identifier(file, e, name).and_then(|sym| self.files().value_declaration(sym));
                return match declared {
                    Some((of, Decl::Var(pat) | Decl::Param(pat))) => self.missing_layout_of_pattern_source(of, pat, known, depth),
                    _ => None,
                };
            }
            _ => Vec::new(),
        };
        if let Some(found) = sources.into_iter().find_map(|source| self.missing_layout_among_sources(file, source, known, depth + 1)) {
            return Some(found);
        }
        let (ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) = hir[e].kind else { return None };
        let (declared_in, ..) = called?;
        if !self.is_declaration_only(declared_in) && !self.is_untyped_file(declared_in) {
            return None;
        }
        let named_first = match hir[hir[call].callee].kind {
            ExprKind::Dot { obj, .. } => obj,
            _ => hir[call].callee,
        };
        if self.files().module(declared_in).is_lib && !self.is_global_of_the_library(file, named_first) {
            return None;
        }
        let callee = hir[hir[call].callee];
        let (written, result) = (self.written_text(file, callee.pos, callee.end), self.type_of_expr(file, e));
        let awaited = self.awaited_or_none(result).unwrap_or(result);
        let awaited = match self.data(awaited) {
            TypeData::Intersection(constituents) => {
                let is_of_host = |part: &TypeId| self.type_declaration_site(*part).is_some_and(|declared| !self.files().module(declared.file).is_lib && self.origin_of_declarations_in(declared.file) == ObjectOrigin::Runtime);
                match constituents.iter().copied().filter(|part| !is_of_host(part)).collect::<Vec<TypeId>>()[..] {
                    [only] => only,
                    _ => awaited,
                }
            }
            _ => awaited,
        };
        let (result, awaited) = (self.display_name(result).into_bytes(), self.type_to_string(awaited));
        let found = self.finding_at(Place { file, pos: hir[e].pos }, 100104, vec![written, result, awaited]);
        Some(MissingLayout::Reasons(vec![CompilerDiagnostic { end: callee.end, ..found }]))
    }

    pub fn explain_missing_layout_at(&mut self, explaining: &mut Explaining, file: FileId, pos: u32, classes_without_layout: &FxHashSet<(FileId, ClassId)>) -> Option<MissingLayout> {
        let (patterns_here, starting_here) = (self.patterns_starting_at(explaining, file, pos), self.exprs_starting_at(explaining, file, pos));
        let known = Known { marks: &explaining.marks, classes_without_layout, asked_about: Some(Place { file, pos }), sources_left: Cell::new(MAX_SOURCES_SEARCHED) };
        if let Some(found) = patterns_here.into_iter().find_map(|pat| self.missing_layout_of_pattern_source(file, pat, &known, 0)) {
            return Some(found);
        }
        starting_here.into_iter().find_map(|e| self.missing_layout_among_sources(file, e, &known, 0))
    }

    pub fn find_types_passed_to_parameters(&mut self, parameters: &[(FileId, FnId, u32)]) -> Vec<Option<Vec<u8>>> {
        let wanted: FxHashMap<(FileId, FnId), Vec<usize>> = parameters.iter().enumerate().fold(FxHashMap::default(), |mut wanted, (at, &(file, function, _))| {
            wanted.entry((file, function)).or_default().push(at);
            wanted
        });
        let mut passed: Vec<Option<Vec<TypeId>>> = vec![Some(Vec::new()); parameters.len()];
        if wanted.is_empty() {
            return Vec::new();
        }
        for file in (0..self.files().modules.len()).map(|file| FileId(file as u32)) {
            if !self.is_compiled(file) || self.is_declaration_only(file) || self.is_untyped_file(file) {
                continue;
            }
            let hir = self.hir(file);
            for &e in self.file_exprs_by_kind(file).of(ExprTag::Call) {
                let ExprKind::Call(call) = hir[e].kind else { continue };
                self.prepare_enclosing(file, e);
                let Some((declared_in, function, _)) = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)) else { continue };
                let Some(asked) = wanted.get(&(declared_in, function)) else { continue };
                let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                let first_spread = arguments.iter().position(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_))).unwrap_or(arguments.len());
                for &at in asked {
                    let index = parameters[at].2 as usize;
                    match arguments.get(index).filter(|_| index < first_spread) {
                        Some(&argument) => {
                            let ty = self.type_of_expr(file, argument);
                            let ty = self.get_widened_type(ty);
                            if self.is_any_or_unknown(ty) {
                                passed[at] = None;
                            } else if let Some(known) = &mut passed[at]
                                && !known.contains(&ty)
                            {
                                known.push(ty);
                            }
                        }
                        None => passed[at] = None,
                    }
                }
            }
        }
        (passed.into_iter())
            .map(|passed| {
                let passed = passed?;
                let widest = passed.iter().copied().find(|&candidate| passed.iter().all(|&other| other == candidate || self.is_assignable(other, candidate)))?;
                Some(self.type_to_string(widest)).filter(|text| text.len() <= MAX_SUGGESTED_TYPE_LENGTH)
            })
            .collect()
    }

    pub fn explain_missing_layout(&mut self, explaining: &Explaining, file: FileId, receiver: ExprId, pattern: PatId, classes_without_layout: &FxHashSet<(FileId, ClassId)>) -> MissingLayout {
        let known = Known { marks: &explaining.marks, classes_without_layout, asked_about: None, sources_left: Cell::new(MAX_SOURCES_SEARCHED) };
        let found = if receiver.is_some() {
            self.missing_layout_among_sources(file, receiver, &known, 0)
        } else {
            let (destructured, at) = (self.type_of_pat(file, pattern), Place { file, pos: self.hir(file)[pattern].pos });
            match self.find_untyped_origin_of_receiver(file, receiver, pattern) {
                Some(origin) => Some(MissingLayout::UntypedValue(Box::new(origin))),
                None => Some(self.reasons_for_type_without_layout(destructured, at, &known)).filter(|reasons| !reasons.is_empty()).map(MissingLayout::Reasons).or_else(|| self.missing_layout_of_pattern_source(file, pattern, &known, 0)),
            }
        };
        found.unwrap_or_else(|| MissingLayout::Reasons(if receiver.is_some() { self.declaration_behind_receiver(file, receiver).into_iter().collect() } else { Vec::new() }))
    }

    fn follow_to_untyped_origin(&mut self, file: FileId, value: ExprId, mut derivation: Vec<Derivation>) -> UntypedOrigin {
        let (mut file, mut e) = (file, value);
        for _ in 0..MAX_STEPS {
            self.prepare_enclosing(file, e);
            match self.step_towards_untyped_origin(file, e, &mut derivation) {
                Step::Continue(next_file, next) => (file, e) = (next_file, next),
                Step::Root(origin) => {
                    derivation.reverse();
                    return UntypedOrigin { derivation, ..*origin };
                }
            }
        }
        let node = self.hir(file)[e];
        self.untyped_root(Place { file, pos: node.pos }, node.end, 100075, vec![b"any".to_vec()])
    }
}
