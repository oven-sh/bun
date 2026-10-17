use super::Place;
use super::integers::INT32;
use crate::atom::Atom;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId};
use crate::check::Checker;
use crate::hir::{
    BinOp, ClassId, ExprId, ExprKind, ExprTag, File, FileKind, Flags, FnBody, FnId, Keyword, MemberId, MemberKind, ParamId, PatKind, PatPropId, PropId, PropKind,
    StmtId, StmtKind, TypeNodeId, TypeNodeKind, UnOp, VarDeclId, VarKind,
};
use crate::program::{FileId, Sym};
use crate::types::{PropSource, TypeId};
use crate::util::FxHashMap;
use smallvec::SmallVec;
use std::hash::Hash;

const SMALL_PROPERTIES: [&[u8]; 6] = [b"length", b"size", b"index", b"lastIndex", b"byteLength", b"byteOffset"];

const SMALL_METHODS: [&[u8]; 32] = [
    b"charCodeAt",
    b"codePointAt",
    b"indexOf",
    b"lastIndexOf",
    b"findIndex",
    b"findLastIndex",
    b"search",
    b"push",
    b"unshift",
    b"localeCompare",
    b"getDate",
    b"getDay",
    b"getFullYear",
    b"getHours",
    b"getMilliseconds",
    b"getMinutes",
    b"getMonth",
    b"getSeconds",
    b"getTimezoneOffset",
    b"getUTCDate",
    b"getUTCDay",
    b"getUTCFullYear",
    b"getUTCHours",
    b"getUTCMilliseconds",
    b"getUTCMinutes",
    b"getUTCMonth",
    b"getUTCSeconds",
    b"getInt8",
    b"getUint8",
    b"getInt16",
    b"getUint16",
    b"getInt32",
];

const FLOAT_ARRAYS: [&[u8]; 2] = [b"Float32Array", b"Float64Array"];
const UINT32_ARRAYS: [&[u8]; 1] = [b"Uint32Array"];

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FlowNode<N = Atom> {
    Property(N),
    Variable(FileId, SymbolId),
    Result(FileId, FnId),
    NamedResult(N),
    NamedArgument(N, u32),
}

impl<N> FlowNode<N> {
    fn renamed<M>(self, rename: &mut impl FnMut(N) -> M) -> FlowNode<M> {
        match self {
            FlowNode::Property(name) => FlowNode::Property(rename(name)),
            FlowNode::Variable(file, symbol) => FlowNode::Variable(file, symbol),
            FlowNode::Result(file, func) => FlowNode::Result(file, func),
            FlowNode::NamedResult(name) => FlowNode::NamedResult(rename(name)),
            FlowNode::NamedArgument(name, index) => FlowNode::NamedArgument(rename(name), index),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum NotInt32Reason {
    Fraction,
    Large,
    Division,
    Power,
    Unsigned,
    MathFunction,
    Clock,
    ParsedFraction,
    FloatArray,
    DeclaredOnly,
}

impl NotInt32Reason {
    fn is_fraction(self) -> bool {
        matches!(self, NotInt32Reason::Fraction | NotInt32Reason::Division | NotInt32Reason::MathFunction | NotInt32Reason::ParsedFraction | NotInt32Reason::FloatArray)
    }

    pub fn text(self) -> &'static str {
        match self {
            NotInt32Reason::Fraction => "a literal with a fraction",
            NotInt32Reason::Large => "a literal that is not an int32",
            NotInt32Reason::Division => "a division",
            NotInt32Reason::Power => "`**`",
            NotInt32Reason::Unsigned => "an unsigned number of 32 bits",
            NotInt32Reason::MathFunction => "a function of `Math` that returns fractions",
            NotInt32Reason::Clock => "a time",
            NotInt32Reason::ParsedFraction => "`parseFloat`",
            NotInt32Reason::FloatArray => "an element of an array of floats",
            NotInt32Reason::DeclaredOnly => "a `number` of code that is only declared",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FlowSource<N = Atom> {
    Int32,
    Constant,
    Unknown,
    Not(NotInt32Reason),
    Node(FlowNode<N>),
    NamedNumber(N),
}

#[derive(Copy, Clone, Debug)]
pub struct NumberFlow<N = Atom> {
    pub to: FlowNode<N>,
    pub from: FlowSource<N>,
    pub pos: u32,
}

impl<N> NumberFlow<N> {
    pub fn renamed<M>(self, mut rename: impl FnMut(N) -> M) -> NumberFlow<M> {
        let from = match self.from {
            FlowSource::Int32 => FlowSource::Int32,
            FlowSource::Constant => FlowSource::Constant,
            FlowSource::Unknown => FlowSource::Unknown,
            FlowSource::Not(why) => FlowSource::Not(why),
            FlowSource::Node(node) => FlowSource::Node(node.renamed(&mut rename)),
            FlowSource::NamedNumber(name) => FlowSource::NamedNumber(rename(name)),
        };
        NumberFlow { to: self.to.renamed(&mut rename), from, pos: self.pos }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CodeOwner {
    Module,
    Function(FnId),
    ClassConstructor(ClassId),
}

#[derive(Copy, Clone, Debug)]
pub struct Int32Verdict<N> {
    pub name: N,
    pub is_reached_by_int32: bool,
    pub contrary: Option<(Place, NotInt32Reason)>,
}

impl<N> Int32Verdict<N> {
    pub fn is_expected_int32(&self) -> bool {
        self.is_reached_by_int32 && self.contrary.is_none()
    }
}

pub fn expected_int32<N: Copy + Eq + Hash>(flows: &[(FileId, NumberFlow<N>)], rank_of_file: impl Fn(FileId) -> u32) -> Vec<Int32Verdict<N>> {
    const NONE: u32 = u32::MAX;
    let mut numbers: FxHashMap<FlowNode<N>, u32> = FxHashMap::default();
    let mut nodes: Vec<FlowNode<N>> = Vec::new();
    let mut number_of = |node: FlowNode<N>| {
        *numbers.entry(node).or_insert_with(|| {
            nodes.push(node);
            nodes.len() as u32 - 1
        })
    };
    let mut edges: Vec<(u32, u32)> = Vec::new();
    let mut pending: Vec<u32> = Vec::new();
    let mut constants: Vec<u32> = Vec::new();
    let mut unknown: Vec<u32> = Vec::new();
    let mut contrary: Vec<((u32, u32, NotInt32Reason), FileId, u32)> = Vec::new();
    let mut named_numbers: Vec<((u32, u32), FileId, u32)> = Vec::new();
    for &(file, flow) in flows {
        let to = number_of(flow.to);
        match flow.from {
            FlowSource::Int32 => pending.push(to),
            FlowSource::Constant => constants.push(to),
            FlowSource::Unknown => unknown.push(to),
            FlowSource::Not(why) => contrary.push(((rank_of_file(file), flow.pos, why), file, to)),
            FlowSource::Node(from) => edges.push((number_of(from), to)),
            FlowSource::NamedNumber(name) => {
                let edge = (number_of(FlowNode::NamedResult(name)), to);
                edges.push(edge);
                named_numbers.push((edge, file, flow.pos));
            }
        }
    }
    let mut has_predecessor = vec![false; nodes.len()];
    for &(_, to) in &edges {
        has_predecessor[to as usize] = true;
    }
    for ((from, to), file, pos) in named_numbers {
        if !has_predecessor[from as usize] {
            contrary.push(((rank_of_file(file), pos, NotInt32Reason::DeclaredOnly), file, to));
        }
    }
    for &node in pending.iter().chain(&constants).chain(&unknown).chain(contrary.iter().map(|evidence| &evidence.2)) {
        has_predecessor[node as usize] = true;
    }
    unknown.extend((0..nodes.len() as u32).filter(|&node| !has_predecessor[node as usize]));
    edges.sort_unstable();
    edges.dedup();
    let mut starts: Vec<u32> = vec![0; nodes.len() + 1];
    for &(from, _) in &edges {
        starts[from as usize + 1] += 1;
    }
    for node in 0..nodes.len() {
        starts[node + 1] += starts[node];
    }
    let reached_from = |node: u32| edges[starts[node as usize] as usize..starts[node as usize + 1] as usize].iter().map(|edge| edge.1);

    let [is_reached_by_computed, is_reached_by_constant, is_reached_by_unknown] = [std::mem::take(&mut pending), constants, unknown].map(|mut pending| {
        let mut is_reached = vec![false; nodes.len()];
        while let Some(node) = pending.pop() {
            if !std::mem::replace(&mut is_reached[node as usize], true) {
                pending.extend(reached_from(node));
            }
        }
        is_reached
    });
    contrary.sort_unstable_by_key(|evidence| evidence.0);
    let mut first: Vec<u32> = vec![NONE; nodes.len()];
    for (index, evidence) in contrary.iter().enumerate() {
        pending.push(evidence.2);
        while let Some(node) = pending.pop() {
            if first[node as usize] == NONE {
                first[node as usize] = index as u32;
                pending.extend(reached_from(node));
            }
        }
    }
    let verdict_of = |(number, node): (usize, &FlowNode<N>)| {
        let FlowNode::Property(name) = *node else { return None };
        let evidence = contrary.get(first[number] as usize);
        Some(Int32Verdict { name, is_reached_by_int32: is_reached_by_computed[number] || (is_reached_by_constant[number] && !is_reached_by_unknown[number]), contrary: evidence.map(|&((_, pos, why), file, _)| (Place { file, pos }, why)) })
    };
    nodes.iter().enumerate().filter_map(verdict_of).collect()
}

type Flows = Vec<(CodeOwner, NumberFlow)>;
type Sources = SmallVec<[(FlowSource, u32); 4]>;

#[derive(Copy, Clone)]
enum Accessed {
    Node(FlowNode),
    DeclaredOnly(bool),
}

#[derive(Copy, Clone)]
enum Called {
    Unknown,
    DeclaredOnly(bool),
    Function(FileId, FnId),
    Named(Atom),
}

fn is_int32(value: f64) -> bool {
    value.fract() == 0.0 && value >= INT32.0 as f64 && value <= INT32.1 as f64
}

fn may_annotate_number(hir: &File, node: TypeNodeId) -> bool {
    node.is_none()
        || !matches!(
            hir[node].kind,
            TypeNodeKind::Keyword(
                Keyword::Never | Keyword::Void | Keyword::Undefined | Keyword::Null | Keyword::String | Keyword::Boolean | Keyword::BigInt | Keyword::Symbol | Keyword::Object | Keyword::This
            ) | TypeNodeKind::StringLit(_)
                | TypeNodeKind::BigIntLit { .. }
                | TypeNodeKind::BoolLit(_)
                | TypeNodeKind::Template { .. }
                | TypeNodeKind::Array(_)
                | TypeNodeKind::Tuple(_)
                | TypeNodeKind::Fn(_)
                | TypeNodeKind::Object(_)
        )
}

fn is_number_keyword(hir: &File, node: TypeNodeId) -> bool {
    node.is_some() && matches!(hir[node].kind, TypeNodeKind::Keyword(Keyword::Number))
}

fn has_body(hir: &File, func: FnId) -> bool {
    func.is_some() && !matches!(hir[func].body, FnBody::None)
}

impl<'p, 's> Checker<'p, 's> {

    pub fn number_flows_in(&mut self, file: FileId) -> Vec<(CodeOwner, NumberFlow)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut out = Flows::new();
        if matches!(hir.kind, FileKind::Declaration | FileKind::Json) || bound.ran_out_of_stack {
            return out;
        }
        let by_kind = self.file_exprs_by_kind(file);
        for &e in by_kind.of(ExprTag::Assign) {
            self.add_assignment_flows(file, e, &mut out);
        }
        for &e in by_kind.of(ExprTag::Unary) {
            self.add_update_flows(file, e, &mut out);
        }
        for tag in [ExprTag::Call, ExprTag::New] {
            for &e in by_kind.of(tag) {
                self.add_argument_flows(file, e, &mut out);
            }
        }
        for prop in (0..hir.props.len() as u32).map(PropId) {
            self.add_property_flows(file, prop, &mut out);
        }
        for declaration in (0..hir.var_decls.len() as u32).map(VarDeclId) {
            self.add_variable_flows(file, declaration, &mut out);
        }
        for prop in (0..hir.pat_props.len() as u32).map(PatPropId) {
            self.add_pattern_flows(file, prop, &mut out);
        }
        for param in (0..hir.params.len() as u32).map(ParamId) {
            self.add_parameter_flows(file, param, &mut out);
        }
        for stmt in (0..hir.stmts.len() as u32).map(StmtId) {
            if let StmtKind::Return(value) = hir[stmt].kind
                && let Some(CodeOwner::Function(func)) = self.owning_code(file, bound.stmt_parent[stmt.idx()])
            {
                self.add_result_flows(file, func, value, &mut out);
            }
        }
        for func in (0..hir.fns.len() as u32).map(FnId) {
            if let FnBody::Expr(value) = hir[func].body {
                self.add_result_flows(file, func, value, &mut out);
            }
        }
        for member in (0..hir.members.len() as u32).map(MemberId) {
            self.add_member_flows(file, member, &mut out);
        }
        out
    }

    pub fn explain_int32_fields(&self, verdicts: &[Int32Verdict<&[u8]>]) -> Vec<String> {
        let line_of = |verdict: &Int32Verdict<&[u8]>| {
            let name = bstr::BStr::new(verdict.name);
            match verdict.contrary {
                Some((at, why)) => format!("integers: `{name}`: not expected to hold int32s: {} at {}", why.text(), self.display_location(at)),
                None if verdict.is_reached_by_int32 => format!("integers: `{name}`: expected to hold int32s"),
                None => format!("integers: `{name}`: nothing is known of the numbers it holds"),
            }
        };
        verdicts.iter().map(line_of).collect()
    }

    pub(super) fn owning_code(&self, file: FileId, mut parent: Parent) -> Option<CodeOwner> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(func) => return Some(CodeOwner::Function(func)),
                Parent::ParamDefault(p) => return Some(CodeOwner::Function(bound.param_fn[p.idx()])),
                Parent::MemberInit(member) if !hir[member].flags.contains(Flags::STATIC) => {
                    let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return None };
                    return Some(CodeOwner::ClassConstructor(class));
                }
                Parent::File => return Some(CodeOwner::Module),
                Parent::None => return None,
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    fn add_flows_into(&mut self, file: FileId, to: FlowNode, value: ExprId, by: CodeOwner, out: &mut Flows) {
        if self.bound(file).is_unchecked(value.idx()) {
            return;
        }
        let mut sources = Sources::new();
        self.add_number_sources(file, value, false, &mut sources);
        out.extend(sources.into_iter().filter(|source| source.0 != FlowSource::Node(to)).map(|(from, pos)| (by, NumberFlow { to, from, pos })));
    }

    fn add_assignment_flows(&mut self, file: FileId, e: ExprId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Assign { op, target, value } = hir[e].kind else { return };
        if bound.is_unchecked(e.idx()) || bound.is_shorthand_property_assignment(hir, e) || bound.get_assignment_target(hir, e).is_some() {
            return;
        }
        let Some(by) = self.owning_code(file, bound.expr_parent[e.idx()]) else { return };
        let Some(to) = self.store_target_node(file, target) else { return };
        match op {
            None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                self.add_flows_into(file, to, value, by, out);
                if let FlowNode::Property(name) = to
                    && let Some(function) = self.function_for_syntax(file, value)
                {
                    self.add_named_function_flows(name, function, hir[value].pos, by, out);
                }
            }
            Some(_) => self.add_flows_into(file, to, e, by, out),
        }
    }

    fn add_update_flows(&mut self, file: FileId, e: ExprId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, operand } = hir[e].kind else { return };
        if bound.is_unchecked(e.idx()) {
            return;
        }
        let Some(by) = self.owning_code(file, bound.expr_parent[e.idx()]) else { return };
        let Some(to) = self.store_target_node(file, operand) else { return };
        out.push((by, NumberFlow { to, from: FlowSource::Int32, pos: hir[e].pos }));
    }

    fn store_target_node(&mut self, file: FileId, mut target: ExprId) -> Option<FlowNode> {
        let hir = self.hir(file);
        let accessed = loop {
            match hir[target].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => target = expr,
                ExprKind::Ident(name) => {
                    let sym = self.value_symbol_for(file, target, name)?;
                    let (of, decl @ (Decl::Var(_) | Decl::Param(_))) = self.files().value_declaration(sym)? else { return None };
                    return (!self.is_declaration_only_at(of, decl)).then_some(FlowNode::Variable(sym.file, sym.id));
                }
                ExprKind::Dot { obj, name, .. } => break self.classify_property_access(file, obj, name),
                ExprKind::Index { obj, index, .. } => {
                    let name = match hir[index].kind {
                        ExprKind::String(name) => name,
                        _ => self.property_named_by_constant_symbol(file, index)?,
                    };
                    break self.classify_property_access(file, obj, name);
                }
                _ => return None,
            }
        };
        match accessed {
            Accessed::Node(node) => Some(node),
            Accessed::DeclaredOnly(_) => None,
        }
    }

    fn add_argument_flows(&mut self, file: FileId, e: ExprId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[e].kind else { return };
        if bound.is_unchecked(e.idx()) {
            return;
        }
        let mut given: SmallVec<[(usize, Sources); 4]> = SmallVec::new();
        for (index, argument) in hir.ids(hir[call].args).enumerate() {
            if matches!(hir[argument].kind, ExprKind::Spread(_)) {
                break;
            }
            let mut sources = Sources::new();
            self.add_number_sources(file, argument, false, &mut sources);
            if !sources.is_empty() {
                given.push((index, sources));
            }
        }
        if given.is_empty() {
            return;
        }
        let Some(by) = self.owning_code(file, bound.expr_parent[e.idx()]) else { return };
        let called = self.classify_callee(file, e);
        for (index, sources) in given {
            let to = match called {
                Called::Function(of, func) => self.parameter_at((of, func), index),
                Called::Named(name) => Some(FlowNode::NamedArgument(name, index as u32)),
                Called::Unknown | Called::DeclaredOnly(_) => None,
            };
            let Some(to) = to else { continue };
            out.extend(sources.into_iter().filter(|source| source.0 != FlowSource::Node(to)).map(|(from, pos)| (by, NumberFlow { to, from, pos })));
        }
    }

    fn add_property_flows(&mut self, file: FileId, prop: PropId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (p, owner) = (&hir[prop], bound.prop_owner[prop.idx()]);
        let Some(name) = self.known_member_name(file, p.key) else { return };
        if owner.is_none() || p.value.is_none() || bound.is_unchecked(owner.idx()) || bound.get_assignment_target(hir, owner).is_some() {
            return;
        }
        let to = FlowNode::Property(name);
        match (p.kind, hir[p.value].kind) {
            (PropKind::Init | PropKind::Shorthand, _) => {
                let Some(by) = self.owning_code(file, Parent::Prop(prop)) else { return };
                self.add_flows_into(file, to, p.value, by, out);
                if let Some(function) = self.function_for_syntax(file, p.value) {
                    self.add_named_function_flows(name, function, p.pos, by, out);
                }
            }
            (PropKind::Method, ExprKind::Fn(func)) => self.add_named_function_flows(name, (file, func), p.pos, CodeOwner::Function(func), out),
            (PropKind::Getter, ExprKind::Fn(func)) => out.push((CodeOwner::Function(func), NumberFlow { to, from: FlowSource::Node(FlowNode::Result(file, func)), pos: p.pos })),
            (PropKind::Setter, ExprKind::Fn(func)) => {
                if let Some(parameter) = self.parameter_at((file, func), 0) {
                    out.push((CodeOwner::Function(func), NumberFlow { to: parameter, from: FlowSource::Node(to), pos: p.pos }));
                }
            }
            _ => {}
        }
    }

    fn add_variable_flows(&mut self, file: FileId, declaration: VarDeclId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let d = &hir[declaration];
        if d.init.is_none() || d.pat.is_none() || d.flags.contains(Flags::AMBIENT) || !matches!(hir[d.pat].kind, PatKind::Ident(_)) || !may_annotate_number(hir, d.ty) {
            return;
        }
        let Some(symbol) = bound.pat_symbol[d.pat.idx()].some() else { return };
        let Some(by) = self.owning_code(file, Parent::VarInit(declaration)) else { return };
        let sym = self.files().sym(file, symbol);
        self.add_flows_into(file, FlowNode::Variable(sym.file, sym.id), d.init, by, out);
    }

    fn add_pattern_flows(&mut self, file: FileId, prop: PatPropId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let p = &hir[prop];
        let Some(key) = self.known_member_name(file, p.key) else { return };
        if p.is_rest || p.value.is_none() || !matches!(hir[p.value].kind, PatKind::Ident(_)) {
            return;
        }
        let Some(symbol) = bound.pat_symbol[p.value.idx()].some() else { return };
        let Some(by) = self.owning_code(file, Parent::PatPropDefault(prop)) else { return };
        let sym = self.files().sym(file, symbol);
        let to = FlowNode::Variable(sym.file, sym.id);
        out.push((by, NumberFlow { to, from: FlowSource::Node(FlowNode::Property(key)), pos: p.pos }));
        if p.default.is_some() {
            self.add_flows_into(file, to, p.default, by, out);
        }
    }

    fn add_parameter_flows(&mut self, file: FileId, param: ParamId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (p, func) = (&hir[param], bound.param_fn[param.idx()]);
        if p.pat.is_none() || !has_body(hir, func) || !may_annotate_number(hir, p.ty) {
            return;
        }
        let PatKind::Ident(name) = hir[p.pat].kind else { return };
        let Some(symbol) = bound.pat_symbol[p.pat.idx()].some() else { return };
        let sym = self.files().sym(file, symbol);
        let parameter = FlowNode::Variable(sym.file, sym.id);
        if p.default.is_some() {
            self.add_flows_into(file, parameter, p.default, CodeOwner::Function(func), out);
        }
        if p.flags.contains(Flags::PARAMETER_PROPERTY) {
            out.push((CodeOwner::Function(func), NumberFlow { to: FlowNode::Property(name), from: FlowSource::Node(parameter), pos: p.pos }));
        }
    }

    fn add_result_flows(&mut self, file: FileId, func: FnId, value: ExprId, out: &mut Flows) {
        let f = &self.hir(file)[func];
        if value.is_none() || f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) || !may_annotate_number(self.hir(file), f.ret) {
            return;
        }
        self.add_flows_into(file, FlowNode::Result(file, func), value, CodeOwner::Function(func), out);
    }

    fn add_member_flows(&mut self, file: FileId, member: MemberId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let m = &hir[member];
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return };
        let Some(name) = self.known_member_name(file, m.key) else { return };
        if m.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT) || hir[class].flags.contains(Flags::AMBIENT) {
            return;
        }
        let to = FlowNode::Property(name);
        match m.kind {
            MemberKind::Property if m.init.is_some() && may_annotate_number(hir, m.ty) => {
                let Some(by) = self.owning_code(file, Parent::MemberInit(member)) else { return };
                self.add_flows_into(file, to, m.init, by, out);
                if let Some(function) = self.function_for_syntax(file, m.init) {
                    self.add_named_function_flows(name, function, m.name_pos, by, out);
                }
            }
            MemberKind::Method if has_body(hir, m.func) => self.add_named_function_flows(name, (file, m.func), m.name_pos, CodeOwner::Function(m.func), out),
            MemberKind::Getter if has_body(hir, m.func) => {
                out.push((CodeOwner::Function(m.func), NumberFlow { to, from: FlowSource::Node(FlowNode::Result(file, m.func)), pos: m.name_pos }));
            }
            MemberKind::Setter if has_body(hir, m.func) => {
                if let Some(parameter) = self.parameter_at((file, m.func), 0) {
                    out.push((CodeOwner::Function(m.func), NumberFlow { to: parameter, from: FlowSource::Node(to), pos: m.name_pos }));
                }
            }
            _ => {}
        }
    }

    fn add_named_function_flows(&mut self, name: Atom, function: (FileId, FnId), pos: u32, by: CodeOwner, out: &mut Flows) {
        let hir = self.hir(function.0);
        let f = &hir[function.1];
        if may_annotate_number(hir, f.ret) && !f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            out.push((by, NumberFlow { to: FlowNode::NamedResult(name), from: FlowSource::Node(FlowNode::Result(function.0, function.1)), pos }));
        }
        for index in 0..f.params.len() {
            if may_annotate_number(hir, hir[f.params.at(index)].ty)
                && let Some(parameter) = self.parameter_at(function, index)
            {
                out.push((by, NumberFlow { to: parameter, from: FlowSource::Node(FlowNode::NamedArgument(name, index as u32)), pos }));
            }
        }
    }

    fn value_symbol_for(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        let sym = self.symbol_of_identifier(file, e, name)?;
        if self.files().flags(sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(sym) } else { Some(sym) }
    }

    fn is_declaration_only_at(&self, of: FileId, decl: Decl) -> bool {
        let hir = self.hir(of);
        !self.is_compiled(of) || self.bound(of).modifier_flags(hir, decl).contains(Flags::AMBIENT)
    }

    fn is_declared_number(&self, of: FileId, decl: Decl) -> bool {
        let (hir, bound) = (self.hir(of), self.bound(of));
        let node = match decl {
            Decl::Member(member) if hir[member].func.is_some() => hir[hir[member].func].ret,
            Decl::Member(member) => hir[member].ty,
            Decl::Var(pat) => match bound.pat_parent[pat.idx()] {
                PatParent::Var(declaration) => hir[declaration].ty,
                _ => TypeNodeId::NONE,
            },
            _ => TypeNodeId::NONE,
        };
        is_number_keyword(hir, node)
    }

    fn classify_property_access(&mut self, file: FileId, obj: ExprId, name: Atom) -> Accessed {
        if self.is_untyped_file(file) {
            return Accessed::Node(FlowNode::Property(name));
        }
        let ty = self.type_of_expr(file, obj);
        if let Some((prop, _)) = self.get_property_of_type(ty, name)
            && let PropSource::Symbol(sym) = &prop.source
        {
            let sym = if self.files().flags(*sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(*sym) } else { Some(*sym) };
            match sym.and_then(|sym| Some((sym, self.files().value_declaration(sym)?))) {
                Some((_, (of, decl))) if self.is_declaration_only_at(of, decl) => return Accessed::DeclaredOnly(self.is_declared_number(of, decl)),
                Some((sym, (_, Decl::Var(_)))) => return Accessed::Node(FlowNode::Variable(sym.file, sym.id)),
                _ => {}
            }
        }
        Accessed::Node(FlowNode::Property(name))
    }

    pub(super) fn implementation_for(&self, of: FileId, func: FnId) -> Option<(FileId, FnId)> {
        let (hir, bound) = (self.hir(of), self.bound(of));
        if has_body(hir, func) {
            return Some((of, func));
        }
        match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => {
                let symbol = bound.symbols.get(bound.fn_symbol[func.idx()].idx())?;
                symbol.decls.iter().find_map(|decl| match *decl {
                    Decl::Fn(other) if has_body(hir, other) => Some((of, other)),
                    _ => None,
                })
            }
            FnOwner::Member(member) if hir[member].kind == MemberKind::Constructor => {
                let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return None };
                let constructors = hir[class].members.iter().filter(|&other| hir[other].kind == MemberKind::Constructor);
                constructors.map(|other| hir[other].func).find(|&other| has_body(hir, other)).map(|other| (of, other))
            }
            FnOwner::Member(member) if hir[member].kind == MemberKind::Method => {
                let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return None };
                let symbol = bound.member_symbol[member.idx()].some()?;
                let overloads = hir[class].members.iter().filter(|&other| hir[other].kind == MemberKind::Method && bound.member_symbol[other.idx()] == symbol);
                overloads.map(|other| hir[other].func).find(|&other| has_body(hir, other)).map(|other| (of, other))
            }
            _ => None,
        }
    }

    pub(super) fn function_for_syntax(&mut self, file: FileId, mut e: ExprId) -> Option<(FileId, FnId)> {
        let hir = self.hir(file);
        loop {
            match hir[e].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => e = expr,
                ExprKind::Fn(func) => return Some((file, func)),
                ExprKind::Ident(name) => {
                    let sym = self.value_symbol_for(file, e, name)?;
                    return match self.files().value_declaration(sym)? {
                        (of, Decl::Fn(func)) => self.implementation_for(of, func),
                        (of, Decl::Class(class)) => {
                            let hir = self.hir(of);
                            hir[class].members.iter().map(|member| &hir[member]).find(|m| m.kind == MemberKind::Constructor && has_body(hir, m.func)).map(|m| (of, m.func))
                        }
                        (of, Decl::Var(pat)) => {
                            let PatParent::Var(declaration) = self.bound(of).pat_parent[pat.idx()] else { return None };
                            let d = &self.hir(of)[declaration];
                            match self.hir(of)[d.init.some()?].kind {
                                ExprKind::Fn(func) if d.kind == VarKind::Const => Some((of, func)),
                                _ => None,
                            }
                        }
                        _ => None,
                    };
                }
                _ => return None,
            }
        }
    }

    fn parameter_at(&self, (of, func): (FileId, FnId), index: usize) -> Option<FlowNode> {
        let (hir, bound) = (self.hir(of), self.bound(of));
        let params = hir[func].params;
        if index >= params.len() {
            return None;
        }
        let p = &hir[params.at(index)];
        if p.flags.contains(Flags::REST) || p.pat.is_none() || !matches!(hir[p.pat].kind, PatKind::Ident(_)) {
            return None;
        }
        let sym = self.files().sym(of, bound.pat_symbol[p.pat.idx()].some()?);
        Some(FlowNode::Variable(sym.file, sym.id))
    }

    fn classify_callee(&mut self, file: FileId, e: ExprId) -> Called {
        let hir = self.hir(file);
        let (call, is_new) = match hir[e].kind {
            ExprKind::Call(call) => (call, false),
            ExprKind::New(call) => (call, true),
            _ => return Called::Unknown,
        };
        let callee = hir[call].callee;
        let named = match hir[callee].kind {
            ExprKind::Dot { name, .. } if !is_new => Called::Named(name),
            _ => Called::Unknown,
        };
        let denoted = |c: &mut Self| c.function_for_syntax(file, callee).map_or(Called::Unknown, |(of, func)| Called::Function(of, func));
        if self.is_untyped_file(file) {
            return if let Called::Named(_) = named { named } else { denoted(self) };
        }
        let Some((of, func, _)) = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)) else {
            return if let Called::Named(_) = named { named } else { denoted(self) };
        };
        let declared_in = self.hir(of);
        if !self.is_compiled(of) || declared_in[func].flags.contains(Flags::AMBIENT) {
            return Called::DeclaredOnly(is_number_keyword(declared_in, declared_in[func].ret));
        }
        let implementation = |c: &Self| c.implementation_for(of, func).map_or(Called::Unknown, |(of, func)| Called::Function(of, func));
        match self.bound(of).fns[func.idx()].owner {
            FnOwner::Stmt(_) => implementation(self),
            FnOwner::Member(member) if declared_in[member].kind == MemberKind::Constructor => implementation(self),
            FnOwner::Member(member) => declared_in[member].key.name().map_or(named, Called::Named),
            FnOwner::Expr(_) if matches!(named, Called::Unknown) => implementation(self),
            _ => named,
        }
    }

    fn may_be_number(&self, ty: TypeId) -> bool {
        ty.is_any() || ty == TypeId::UNKNOWN || self.some_type(ty, |c, part| c.is_number_like(part))
    }

    fn add_number_sources(&mut self, file: FileId, e: ExprId, is_rounded: bool, out: &mut Sources) {
        let before = out.len();
        self.add_number_sources_uncached(file, e, is_rounded, out);
        if out.len() != before || e.is_none() {
            return;
        }
        let (kind, pos) = (self.hir(file)[e].kind, self.hir(file)[e].pos);
        let may_be_number = if self.is_untyped_file(file) {
            !matches!(
                kind,
                ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Regex | ExprKind::Template { .. } | ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Fn(_) | ExprKind::Class(_)
            )
        } else if self.is_half_of_stack_in_use() {
            true
        } else {
            let ty = self.type_of_expr(file, e);
            self.may_be_number(ty)
        };
        if may_be_number {
            out.push((FlowSource::Unknown, pos));
        }
    }

    fn add_number_sources_uncached(&mut self, file: FileId, e: ExprId, is_rounded: bool, out: &mut Sources) {
        if e.is_none() || self.is_half_of_stack_in_use() {
            return;
        }
        let hir = self.hir(file);
        let (kind, pos) = (hir[e].kind, hir[e].pos);
        let operands = match kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) | ExprKind::Instantiation { expr, .. } => [expr, ExprId::NONE],
            ExprKind::Binary { op: BinOp::Comma, right, .. } => [right, ExprId::NONE],
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => [left, right],
            ExprKind::Assign { op: None, value, .. } => [value, ExprId::NONE],
            ExprKind::Assign { op: Some(BinOp::And | BinOp::Or | BinOp::Nullish), target, value } => [target, value],
            ExprKind::Cond { yes, no, .. } => [yes, no],
            _ => [ExprId::NONE, ExprId::NONE],
        };
        if operands[0].is_some() {
            for operand in operands {
                self.add_number_sources(file, operand, is_rounded, out);
            }
            return;
        }
        let add_contrary = |why: NotInt32Reason, out: &mut Sources| {
            if !(is_rounded && why.is_fraction()) {
                out.push((FlowSource::Not(why), pos));
            }
        };
        if let ExprKind::Number(index) = kind {
            let value = hir.numbers[index as usize];
            if is_int32(value) {
                out.push((FlowSource::Constant, pos));
            } else {
                add_contrary(if value.fract() != 0.0 { NotInt32Reason::Fraction } else { NotInt32Reason::Large }, out);
            }
            return;
        }
        if !self.is_untyped_file(file) {
            let ty = self.type_of_expr(file, e);
            if !self.may_be_number(ty) {
                return;
            }
            if let Some((minimum, maximum)) = self.expr_integer_range(file, e)
                && minimum >= INT32.0
                && maximum <= INT32.1
            {
                out.push((if minimum == maximum { FlowSource::Constant } else { FlowSource::Int32 }, pos));
                return;
            }
        }
        let arithmetic = match kind {
            ExprKind::Binary { op, left, right } => Some((op, left, right)),
            ExprKind::Assign { op: Some(op), target, value } => Some((op, target, value)),
            _ => None,
        };
        if let Some((op, left, right)) = arithmetic {
            match op {
                BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Rem => {}
                BinOp::Div if is_rounded => {}
                BinOp::Div => return add_contrary(NotInt32Reason::Division, out),
                BinOp::Pow => return add_contrary(NotInt32Reason::Power, out),
                BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr => return out.push((FlowSource::Int32, pos)),
                BinOp::UShr => return add_contrary(NotInt32Reason::Unsigned, out),
                _ => return,
            }
            self.add_number_sources(file, left, is_rounded, out);
            self.add_number_sources(file, right, is_rounded, out);
            return;
        }
        match kind {
            ExprKind::Ident(name) => {
                let Some(sym) = self.value_symbol_for(file, e, name) else { return };
                let Some((of, decl @ (Decl::Var(_) | Decl::Param(_)))) = self.files().value_declaration(sym) else { return };
                if !self.is_declaration_only_at(of, decl) {
                    out.push((FlowSource::Node(FlowNode::Variable(sym.file, sym.id)), pos));
                } else if self.is_declared_number(of, decl) {
                    add_contrary(NotInt32Reason::DeclaredOnly, out);
                }
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Minus | UnOp::Plus => self.add_number_sources(file, operand, is_rounded, out),
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    out.push((FlowSource::Int32, pos));
                    self.add_number_sources(file, operand, is_rounded, out);
                }
                UnOp::BitNot => out.push((FlowSource::Int32, pos)),
                UnOp::Not | UnOp::Typeof | UnOp::Void | UnOp::Delete => {}
            },
            ExprKind::Dot { obj, name, .. } => self.add_access_sources(file, obj, name, pos, out),
            ExprKind::Index { obj, index, .. } => {
                if let ExprKind::String(name) = hir[index].kind {
                    return self.add_access_sources(file, obj, name, pos, out);
                }
                if let Some(name) = self.property_named_by_constant_symbol(file, index) {
                    return self.add_access_sources(file, obj, name, pos, out);
                }
                if self.is_untyped_file(file) {
                    return;
                }
                let ty = self.type_of_expr(file, obj);
                if !ty.is_never() && self.every_type(ty, |c, part| c.is_global_instance(part, &FLOAT_ARRAYS)) {
                    add_contrary(NotInt32Reason::FloatArray, out);
                } else if !ty.is_never() && self.every_type(ty, |c, part| c.is_global_instance(part, &UINT32_ARRAYS)) {
                    add_contrary(NotInt32Reason::Unsigned, out);
                }
            }
            ExprKind::Call(_) => self.add_call_sources(file, e, is_rounded, out),
            _ => {}
        }
    }

    fn add_access_sources(&mut self, file: FileId, obj: ExprId, name: Atom, pos: u32, out: &mut Sources) {
        let is_small = SMALL_PROPERTIES.contains(&self.atoms().bytes(name));
        match self.classify_property_access(file, obj, name) {
            Accessed::Node(node) => {
                if is_small && self.is_untyped_file(file) {
                    out.push((FlowSource::Int32, pos));
                }
                out.push((FlowSource::Node(node), pos));
            }
            Accessed::DeclaredOnly(_) if is_small => out.push((FlowSource::Int32, pos)),
            Accessed::DeclaredOnly(_) if matches!(self.atoms().bytes(name), b"MAX_VALUE" | b"MAX_SAFE_INTEGER" | b"MIN_SAFE_INTEGER" | b"POSITIVE_INFINITY" | b"NEGATIVE_INFINITY") => {}
            Accessed::DeclaredOnly(true) => out.push((FlowSource::Not(NotInt32Reason::DeclaredOnly), pos)),
            Accessed::DeclaredOnly(false) => {}
        }
    }

    fn add_call_sources(&mut self, file: FileId, e: ExprId, is_rounded: bool, out: &mut Sources) {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return };
        let (callee, args, pos) = (hir[call].callee, hir[call].args, hir[e].pos);
        let add_contrary = |why: NotInt32Reason, out: &mut Sources| {
            if !(is_rounded && why.is_fraction()) {
                out.push((FlowSource::Not(why), pos));
            }
        };
        let mut method: &[u8] = b"";
        match hir[callee].kind {
            ExprKind::Dot { obj, name, .. } => {
                method = self.atoms().bytes(name);
                if self.refers_to_global_object(file, obj, b"Math") {
                    let is_rounding = matches!(method, b"floor" | b"ceil" | b"round" | b"trunc");
                    match method {
                        b"floor" | b"ceil" | b"round" | b"trunc" | b"sign" | b"imul" | b"clz32" => out.push((FlowSource::Int32, pos)),
                        b"min" | b"max" | b"abs" => {}
                        _ => return add_contrary(NotInt32Reason::MathFunction, out),
                    }
                    if !matches!(method, b"sign" | b"imul" | b"clz32") {
                        for argument in hir.ids(args) {
                            self.add_number_sources(file, argument, is_rounded || is_rounding, out);
                        }
                    }
                    return;
                }
                if method == b"now" && (self.refers_to_global_object(file, obj, b"Date") || self.refers_to_global_object(file, obj, b"performance")) {
                    return add_contrary(NotInt32Reason::Clock, out);
                }
                if self.refers_to_global_object(file, obj, b"Number") {
                    match method {
                        b"parseInt" => out.push((FlowSource::Int32, pos)),
                        b"parseFloat" => add_contrary(NotInt32Reason::ParsedFraction, out),
                        _ => {}
                    }
                    return;
                }
            }
            ExprKind::Ident(name) => {
                if self.refers_to_global_object(file, callee, b"parseInt") {
                    return out.push((FlowSource::Int32, pos));
                }
                if self.refers_to_global_object(file, callee, b"parseFloat") {
                    return add_contrary(NotInt32Reason::ParsedFraction, out);
                }
                if self.refers_to_global_object(file, callee, b"Number") {
                    return;
                }
                if let Some(sym) = self.value_symbol_for(file, callee, name)
                    && let Some((_, Decl::Var(_))) = self.files().value_declaration(sym)
                {
                    return self.add_callee_result_sources(file, callee, pos, 0, out);
                }
            }
            _ => {}
        }
        let (is_small, is_clock) = (SMALL_METHODS.contains(&method), matches!(method, b"now" | b"getTime"));
        match self.classify_callee(file, e) {
            Called::Unknown => self.add_callee_result_sources(file, callee, pos, 0, out),
            Called::DeclaredOnly(_) if is_small => out.push((FlowSource::Int32, pos)),
            Called::DeclaredOnly(_) if is_clock => add_contrary(NotInt32Reason::Clock, out),
            Called::DeclaredOnly(is_number) => {
                if is_number {
                    add_contrary(NotInt32Reason::DeclaredOnly, out);
                }
            }
            Called::Function(of, func) => out.push((FlowSource::Node(FlowNode::Result(of, func)), pos)),
            Called::Named(name) => {
                if is_clock {
                    add_contrary(NotInt32Reason::Clock, out);
                }
                if self.is_untyped_file(file) {
                    if is_small {
                        out.push((FlowSource::Int32, pos));
                    }
                    return out.push((FlowSource::Node(FlowNode::NamedResult(name)), pos));
                }
                let ty = self.type_of_expr(file, e);
                let is_number = !ty.is_never() && self.every_type(ty, |c, part| c.is_number_like(part) || part.is_undefined() || part.is_null());
                let declared = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig));
                let is_optional = declared.is_some_and(|(of, func, _)| matches!(self.bound(of).fns[func.idx()].owner, FnOwner::Member(member) if self.hir(of)[member].flags.contains(Flags::OPTIONAL)));
                let is_optional = is_optional
                    || match self.hir(file)[callee].kind {
                        ExprKind::Dot { obj, .. } => {
                            let object = self.type_of_expr(file, obj);
                            self.get_property_of_type(object, name).is_some_and(|(prop, _)| prop.flags.contains(crate::types::PropFlags::OPTIONAL))
                        }
                        _ => false,
                    };
                out.push((if is_number && !is_optional { FlowSource::NamedNumber(name) } else { FlowSource::Node(FlowNode::NamedResult(name)) }, pos));
            }
        }
    }

    fn add_callee_result_sources(&mut self, file: FileId, callee: ExprId, pos: u32, depth: u32, out: &mut Sources) {
        const MAX_DEPTH: u32 = 4;
        if callee.is_none() || self.is_half_of_stack_in_use() {
            return;
        }
        let operands = match self.hir(file)[callee].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => [expr, ExprId::NONE],
            ExprKind::Cond { yes, no, .. } => [yes, no],
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => [left, right],
            ExprKind::Fn(func) => return out.push((FlowSource::Node(FlowNode::Result(file, func)), pos)),
            ExprKind::Ident(name) => {
                let Some(sym) = self.value_symbol_for(file, callee, name) else { return };
                match self.files().value_declaration(sym) {
                    Some((of, Decl::Fn(func))) => out.extend(self.implementation_for(of, func).map(|(of, func)| (FlowSource::Node(FlowNode::Result(of, func)), pos))),
                    Some((of, Decl::Var(pat))) if depth < MAX_DEPTH => {
                        let PatParent::Var(declaration) = self.bound(of).pat_parent[pat.idx()] else { return };
                        let d = &self.hir(of)[declaration];
                        if d.kind == VarKind::Const {
                            self.add_callee_result_sources(of, d.init, pos, depth + 1, out);
                        }
                    }
                    _ => {}
                }
                return;
            }
            ExprKind::Dot { obj, name, .. } => {
                let is_clock = matches!(self.atoms().bytes(name), b"now" | b"getTime");
                match self.classify_property_access(file, obj, name) {
                    _ if is_clock => out.push((FlowSource::Not(NotInt32Reason::Clock), pos)),
                    Accessed::DeclaredOnly(true) => out.push((FlowSource::Not(NotInt32Reason::DeclaredOnly), pos)),
                    Accessed::Node(FlowNode::Property(name)) => out.push((FlowSource::Node(FlowNode::NamedResult(name)), pos)),
                    _ => {}
                }
                return;
            }
            _ => return,
        };
        for operand in operands {
            self.add_callee_result_sources(file, operand, pos, depth, out);
        }
    }
}
