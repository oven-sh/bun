use super::flows::{Membership, Place};
use super::integers::{INT32, Int32Proof, Store};
use super::storage::Primitive;
use super::subtypes::Cause;
use crate::atom::Atom;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId, UNREACHABLE};
use crate::check::{Checker, CompilerDiagnostic};
use crate::hir::{
    BinOp, ExprId, ExprKind, ExprTag, FileKind, Flags, FnBody, FnId, FnKind, Member, MemberId,
    MemberKind, ParamId, PatKind, PropId, PropKind, StmtId, StmtKind, TypeNodeId, TypeNodeKind,
    UnOp, VarDeclId, VarKind,
};
use crate::program::{FileId, Sym};
use crate::types::{Origin, Prop, PropFlags, PropSource, TypeData, TypeId};
use crate::util::FxHashMap;
use smallvec::SmallVec;

const UNPROVEN: u32 = 100031;
const NOT_AN_INT32: u32 = 100032;
const USED_AS_A_VALUE: u32 = 100033;
const DIFFERS_BETWEEN_TYPES: u32 = 100034;
const DECLARED_HERE: u32 = 100035;
const MAX_QUOTED_LENGTH: usize = 48;

type Indices = SmallVec<[u32; 2]>;

#[derive(Default)]
struct Search {
    found: Vec<CompilerDiagnostic>,
    int32_parameters: FxHashMap<(FileId, FnId), Indices>,
}

#[derive(Copy, Clone)]
enum Int32Place {
    Variable(Atom),
    Parameter(FileId, FnId, ParamId),
    Property(Sym),
    Result(FileId, FnId),
}

fn quoted(text: &[u8]) -> Vec<u8> {
    [b"'", text, b"'"].concat()
}

impl<'p, 's> Checker<'p, 's> {
    pub fn find_unproven_int32_values(&mut self, file: FileId) -> Vec<CompilerDiagnostic> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut search = Search::default();
        if matches!(hir.kind, FileKind::Declaration | FileKind::Json) || bound.ran_out_of_stack {
            return search.found;
        }
        let by_kind = self.file_exprs_by_kind(file);
        for tag in [ExprTag::Call, ExprTag::New] {
            for &e in by_kind.of(tag) {
                self.check_int32_arguments(file, e, &mut search);
            }
        }
        self.check_uses_of_functions_with_int32_parameters(file, &mut search);
        if self.is_untyped_file(file) {
            return search.found;
        }
        for declaration in (0..hir.var_decls.len() as u32).map(VarDeclId) {
            let d = &hir[declaration];
            if let PatKind::Ident(name) = hir[d.pat].kind
                && d.init.is_some()
                && !d.flags.contains(Flags::AMBIENT)
                && self.is_int32_node(file, d.ty)
            {
                self.check_int32_store(
                    file,
                    Store::Value(d.init),
                    Int32Place::Variable(name),
                    &mut search,
                );
            }
        }
        for p in (0..hir.params.len() as u32).map(ParamId) {
            if hir[p].default.is_some() && self.is_int32_node(file, hir[p].ty) {
                self.check_int32_store(
                    file,
                    Store::Value(hir[p].default),
                    Int32Place::Parameter(file, bound.param_fn[p.idx()], p),
                    &mut search,
                );
            }
        }
        for member in (0..hir.members.len() as u32).map(MemberId) {
            self.check_int32_member(file, member, &mut search);
        }
        for func in (0..hir.fns.len() as u32).map(FnId) {
            self.check_int32_results(file, func, &mut search);
        }
        for tag in [ExprTag::Ident, ExprTag::Dot, ExprTag::Index] {
            for &target in by_kind.of(tag) {
                self.check_int32_assignment(file, target, &mut search);
            }
        }
        for prop in (0..hir.props.len() as u32).map(PropId) {
            self.check_int32_literal_property(file, prop, &mut search);
        }
        search.found
    }

    pub fn find_int32_members_seen_through_other_types(
        &mut self,
        views: &[TypeId],
        membership: &Membership,
    ) -> Vec<CompilerDiagnostic> {
        let mut found = Vec::new();
        let bearing: Vec<Vec<Atom>> = views
            .iter()
            .map(|&view| self.names_of_members_with_int32(view))
            .collect();
        for (wide, subtypes) in membership.subtypes.iter().enumerate() {
            for (place, &own) in subtypes.iter().enumerate() {
                let own = own as usize;
                if own == wide
                    || own >= views.len()
                    || bearing[wide].is_empty() && bearing[own].is_empty()
                    || matches!(membership.causes[wide].get(place), Some(Cause::Fit(_)))
                {
                    continue;
                }
                let mut names: Vec<Atom> =
                    bearing[wide].iter().chain(&bearing[own]).copied().collect();
                names.sort_unstable_by_key(|&name| self.atoms().bytes(name));
                names.dedup();
                for name in names {
                    let (Some((seen_as, _)), Some((made_as, _))) = (
                        self.get_property_of_type(views[wide], name),
                        self.get_property_of_type(views[own], name),
                    ) else {
                        continue;
                    };
                    if !self.int32_members_differ(made_as, seen_as) {
                        continue;
                    }
                    let text = self.atoms().bytes(name).to_vec();
                    let sites: Vec<Place> = [made_as, seen_as]
                        .into_iter()
                        .filter_map(|prop| self.declaration_site_of_prop(prop))
                        .collect();
                    let related: Vec<CompilerDiagnostic> = sites
                        .iter()
                        .map(|&site| self.finding_at(site, DECLARED_HERE, vec![text.clone()]))
                        .collect();
                    let flows_at = match membership.causes[wide].get(place) {
                        Some(&Cause::Upcast(number)) => Some(membership.upcasts[number as usize].2)
                            .filter(|at| at.file != FileId(u32::MAX)),
                        _ => None,
                    };
                    let Some(at) = flows_at.or_else(|| sites.first().copied()) else {
                        continue;
                    };
                    let args = vec![
                        text,
                        self.display_name(views[own]).into_bytes(),
                        self.display_name(views[wide]).into_bytes(),
                    ];
                    found.push(CompilerDiagnostic {
                        related,
                        ..self.finding_at(at, DIFFERS_BETWEEN_TYPES, args)
                    });
                }
            }
        }
        found
    }

    fn member_declaration(&self, prop: &Prop) -> Option<(FileId, MemberId)> {
        let PropSource::Symbol(sym) = &prop.source else {
            return None;
        };
        match self.files().value_declaration(*sym)? {
            (file, Decl::Member(member)) => Some((file, member)),
            _ => None,
        }
    }

    fn declaration_site_of_prop(&self, prop: &Prop) -> Option<Place> {
        let PropSource::Symbol(sym) = &prop.source else {
            return None;
        };
        let (file, decl) = self.files().value_declaration(*sym)?;
        let hir = self.hir(file);
        match decl {
            Decl::Member(member) => Some(Place {
                file,
                pos: hir[member].name_pos,
            }),
            Decl::ParameterProperty(p) => Some(Place {
                file,
                pos: hir[p].pos,
            }),
            Decl::Property(prop) => Some(Place {
                file,
                pos: hir[prop].pos,
            }),
            _ => None,
        }
    }

    fn names_of_members_with_int32(&mut self, view: TypeId) -> Vec<Atom> {
        let mut names = Vec::new();
        for prop in self.properties_of_type(view) {
            let has_int32 = match self.member_declaration(prop) {
                Some((file, member)) if self.hir(file)[member].kind == MemberKind::Method => {
                    let f = self.hir(file)[self.hir(file)[member].func];
                    self.is_int32_node(file, f.ret)
                        || f.params
                            .iter()
                            .any(|p| self.is_int32_node(file, self.hir(file)[p].ty))
                }
                _ => {
                    self.int32_property_symbol(prop, false).is_some()
                        || self.int32_property_symbol(prop, true).is_some()
                }
            };
            if has_int32 {
                names.push(prop.name);
            }
        }
        names
    }

    fn int32_members_differ(&mut self, made_as: &Prop, seen_as: &Prop) -> bool {
        if matches!(made_as.source, PropSource::Type(_))
            || matches!(seen_as.source, PropSource::Type(_))
        {
            return false;
        }
        match (
            self.member_declaration(made_as),
            self.member_declaration(seen_as),
        ) {
            (Some(own), Some(wide)) if own == wide => false,
            (Some(own), Some(wide))
                if self.hir(own.0)[own.1].kind == MemberKind::Method
                    && self.hir(wide.0)[wide.1].kind == MemberKind::Method =>
            {
                self.int32_methods_differ(own, wide)
            }
            _ => {
                let is_read_as_int32 = self.int32_property_symbol(seen_as, false).is_some();
                let is_made_int32 = self.int32_property_symbol(made_as, true).is_some();
                is_read_as_int32 && !is_made_int32
                    || is_made_int32
                        && !is_read_as_int32
                        && !seen_as.flags.contains(PropFlags::READONLY)
            }
        }
    }

    fn is_int32_node(&mut self, file: FileId, node: TypeNodeId) -> bool {
        node.is_some()
            && matches!(
                self.hir(file)[node].kind,
                TypeNodeKind::Ref { .. } | TypeNodeKind::Import { .. }
            )
            && self.is_int32_annotation(file, node, 0)
    }

    fn int32_parameters<'a>(
        &mut self,
        (of, func): (FileId, FnId),
        search: &'a mut Search,
    ) -> &'a Indices {
        search
            .int32_parameters
            .entry((of, func))
            .or_insert_with(|| {
                let params = self.hir(of)[func].params;

                params
                    .iter()
                    .enumerate()
                    .filter(|&(_, p)| self.is_int32_node(of, self.hir(of)[p].ty))
                    .map(|(index, _)| index as u32)
                    .collect()
            });
        &search.int32_parameters[&(of, func)]
    }

    fn value_node_of_member(&self, file: FileId, m: &Member) -> TypeNodeId {
        let hir = self.hir(file);
        match m.kind {
            MemberKind::Property => m.ty,
            MemberKind::Getter => hir[m.func].ret,
            MemberKind::Setter => hir[m.func].effective_set_accessor_type_annotation_node(hir),
            _ => TypeNodeId::NONE,
        }
    }

    fn check_int32_member(&mut self, file: FileId, member: MemberId, search: &mut Search) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let m = &hir[member];
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
            return;
        };
        if m.flags.contains(Flags::AMBIENT) || hir[class].flags.contains(Flags::AMBIENT) {
            return;
        }
        let Some(symbol) = bound.member_symbol[member.idx()].some() else {
            return;
        };
        if m.kind == MemberKind::Property && m.init.is_some() && self.is_int32_node(file, m.ty) {
            self.check_int32_store(
                file,
                Store::Value(m.init),
                Int32Place::Property(self.files().sym(file, symbol)),
                search,
            );
        }
    }

    fn int32_methods_differ(
        &mut self,
        (file, member): (FileId, MemberId),
        (of, base): (FileId, MemberId),
    ) -> bool {
        let (ours, theirs) = (
            self.hir(file)[self.hir(file)[member].func],
            self.hir(of)[self.hir(of)[base].func],
        );
        if self.is_int32_node(of, theirs.ret) && !self.is_int32_node(file, ours.ret) {
            return true;
        }
        ours.params.iter().enumerate().any(|(index, p)| {
            self.is_int32_node(file, self.hir(file)[p].ty)
                && !(index < theirs.params.len()
                    && self.is_int32_node(of, self.hir(of)[theirs.params.at(index)].ty))
        })
    }

    fn check_int32_results(&mut self, file: FileId, func: FnId, search: &mut Search) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if matches!(f.body, FnBody::None)
            || f.flags
                .intersects(Flags::ASYNC | Flags::GENERATOR | Flags::AMBIENT)
            || !self.is_int32_node(file, f.ret)
        {
            return;
        }
        let place = Int32Place::Result(file, func);
        if let FnBody::Expr(value) = f.body {
            return self.check_int32_store(file, Store::Value(value), place, search);
        }
        let returns: Vec<StmtId> = bound.ids(bound.fns[func.idx()].returns).collect();
        for stmt in returns {
            let StmtKind::Return(value) = hir[stmt].kind else {
                continue;
            };
            if value.is_some() {
                self.check_int32_store(file, Store::Value(value), place, search);
            } else {
                let what = self.describe_int32_place(place);
                search.found.push(self.finding_at(
                    Place {
                        file,
                        pos: hir[stmt].start,
                    },
                    UNPROVEN,
                    vec![
                        what,
                        b"what this returns".to_vec(),
                        b"it is undefined".to_vec(),
                        b"Return a value.".to_vec(),
                    ],
                ));
            }
        }
        let end = bound.fns[func.idx()].end;
        if end != UNREACHABLE && end.is_some() && self.is_reachable(file, end) {
            let what = self.describe_int32_place(place);
            search.found.push(self.finding_at(
                Place {
                    file,
                    pos: hir[f.ret].pos,
                },
                UNPROVEN,
                vec![
                    what,
                    b"what it returns at its end".to_vec(),
                    b"it is undefined".to_vec(),
                    b"Return a value on every path.".to_vec(),
                ],
            ));
        }
    }

    fn int32_property(&mut self, holder: TypeId, name: Atom, is_stored_to: bool) -> Option<Sym> {
        let (prop, _) = self.get_property_of_type(holder, name)?;
        self.int32_property_symbol(prop, is_stored_to)
    }

    fn int32_property_symbol(&mut self, prop: &Prop, is_stored_to: bool) -> Option<Sym> {
        if let PropSource::Intersected(_, parts) = &prop.source {
            let mut of_parts = parts
                .iter()
                .map(|part| self.int32_property_symbol(part, is_stored_to));
            return if is_stored_to {
                of_parts.flatten().next()
            } else {
                of_parts
                    .try_fold(None, |_, of_part| of_part.map(Some))
                    .flatten()
            };
        }
        let PropSource::Symbol(sym) = &prop.source else {
            return None;
        };
        let sym = *sym;
        let setter = self
            .files()
            .decls_of(sym)
            .iter()
            .copied()
            .find_map(|(of, decl)| match decl {
                Decl::Member(member) if self.hir(of)[member].kind == MemberKind::Setter => {
                    Some((of, member))
                }
                _ => None,
            });
        if let Some((of, member)) = setter.filter(|_| is_stored_to) {
            let node = self.value_node_of_member(of, &self.hir(of)[member]);
            return self.is_int32_node(of, node).then_some(sym);
        }
        self.annotated_prop_integer_range(prop).map(|_| sym)
    }

    fn type_beneath_assertions(&mut self, file: FileId, mut e: ExprId) -> TypeId {
        let hir = self.hir(file);
        loop {
            let ty = self.type_of_expr(file, e);
            match hir[e].kind {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::NonNull(expr)
                    if self.is_uninformative(ty) =>
                {
                    e = expr
                }
                _ => return self.non_nullable(ty),
            }
        }
    }

    fn check_int32_assignment(&mut self, file: FileId, target: ExprId, search: &mut Search) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if bound.get_assignment_target(hir, target).is_none() || bound.is_unchecked(target.idx()) {
            return;
        }
        let place = match hir[target].kind {
            ExprKind::Ident(name) => {
                let Some(local) = bound.expr_symbol[target.idx()].some() else {
                    return;
                };
                let sym = self.files().sym(file, local);
                let Some((of, Decl::Var(pat) | Decl::Param(pat))) =
                    self.files().value_declaration(sym)
                else {
                    return;
                };
                if !self.integer_slot(sym).is_declared_int32() {
                    return;
                }
                match self.bound(of).pat_parent[pat.idx()] {
                    PatParent::Param(p) => {
                        Int32Place::Parameter(of, self.bound(of).param_fn[p.idx()], p)
                    }
                    _ => Int32Place::Variable(name),
                }
            }
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                let name = match hir[target].kind {
                    ExprKind::Dot { name, .. } => Some(name),
                    ExprKind::Index { index, .. } => match hir[index].kind {
                        ExprKind::String(name) => Some(name),
                        _ => self.property_named_by_constant_symbol(file, index),
                    },
                    _ => None,
                };
                let Some(name) = name else { return };
                let holder = self.type_beneath_assertions(file, obj);
                let Some(sym) = self.int32_property(holder, name, true) else {
                    return;
                };
                Int32Place::Property(sym)
            }
            _ => return,
        };
        match self.target_store(file, target) {
            Some(store) => self.check_int32_store(file, store, place, search),
            None => {
                let what = self.describe_int32_place(place);
                let text = self
                    .quoted_source(file, target)
                    .unwrap_or_else(|| b"this".to_vec());
                let why = b"the compiler does not follow a value through destructuring, the head of a loop or an assertion on the target".to_vec();
                let fix = b"Assign it to a 'number' first, and store that with '| 0'.".to_vec();
                search.found.push(self.finding_over(
                    file,
                    target,
                    UNPROVEN,
                    vec![
                        what,
                        [b"what is assigned to ", &text[..]].concat(),
                        why,
                        fix,
                    ],
                ));
            }
        }
    }

    fn check_int32_literal_property(&mut self, file: FileId, prop: PropId, search: &mut Search) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (p, owner) = (&hir[prop], bound.prop_owner[prop.idx()]);
        if owner.is_none()
            || p.value.is_none()
            || !matches!(
                p.kind,
                PropKind::Init | PropKind::Shorthand | PropKind::Spread
            )
            || !matches!(hir[owner].kind, ExprKind::Object(_))
        {
            return;
        }
        if bound.is_unchecked(owner.idx()) || bound.get_assignment_target(hir, owner).is_some() {
            return;
        }
        let given = self.type_of_expr(file, p.value);
        if p.kind != PropKind::Spread
            && !self.is_uninformative(given)
            && !self.some_type(given, |c, part| c.is_number_like(part))
        {
            return;
        }
        let Some(expected) = self.contextual_type_of_literal(file, owner) else {
            return;
        };
        let expected = self.non_nullable(expected);
        if p.kind != PropKind::Spread {
            if let Some(name) = self.known_member_name(file, p.key)
                && let Some(sym) = self.int32_property(expected, name, true)
            {
                self.check_int32_store(
                    file,
                    Store::Value(p.value),
                    Int32Place::Property(sym),
                    search,
                );
            }
            return;
        }
        let spread = self.type_of_expr(file, p.value);
        let spread = self.non_nullable(spread);
        for wanted in self.properties_of_type(expected) {
            let Some(sym) = self.int32_property_symbol(wanted, true) else {
                continue;
            };
            let is_copied = self.is_uninformative(spread)
                || self.get_property_of_type(spread, wanted.name).is_some();
            if is_copied && self.int32_property(spread, wanted.name, false).is_none() {
                let what = self.describe_int32_place(Int32Place::Property(sym));
                let name = self.atoms().bytes(wanted.name);
                let copied = [b"the '", name, b"' that this spread copies"].concat();
                let fix = [b"Write '", name, b": value | 0' after the spread."].concat();
                search.found.push(self.finding_over(
                    file,
                    p.value,
                    UNPROVEN,
                    vec![
                        what,
                        copied,
                        b"it is not declared 'int32' where it comes from".to_vec(),
                        fix,
                    ],
                ));
            }
        }
    }

    fn called_function(&mut self, file: FileId, e: ExprId) -> Option<(FileId, FnId)> {
        let hir = self.hir(file);
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[e].kind else {
            return None;
        };
        if self.is_untyped_file(file) {
            return self.function_for_syntax(file, hir[call].callee);
        }
        let (of, func, _) = self
            .resolved_signature(file, e)
            .sig
            .and_then(|sig| self.sig_decl(sig))?;
        Some(self.implementation_for(of, func).unwrap_or((of, func)))
    }

    fn check_int32_arguments(&mut self, file: FileId, e: ExprId, search: &mut Search) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[e].kind else {
            return;
        };
        if hir[call].args.is_empty() || bound.is_unchecked(e.idx()) {
            return;
        }
        let Some((of, func)) = self.called_function(file, e) else {
            return;
        };
        let indices = self.int32_parameters((of, func), search).clone();
        if indices.is_empty() {
            return;
        }
        let arguments: SmallVec<[ExprId; 8]> = hir.ids(hir[call].args).collect();
        let first_spread = arguments
            .iter()
            .position(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)));
        for index in indices {
            let place =
                Int32Place::Parameter(of, func, self.hir(of)[func].params.at(index as usize));
            if let Some(spread) = first_spread.filter(|&spread| spread <= index as usize) {
                let what = self.describe_int32_place(place);
                let why =
                    b"the compiler does not follow the elements of a spread argument".to_vec();
                search.found.push(self.finding_over(
                    file,
                    arguments[spread],
                    UNPROVEN,
                    vec![
                        what,
                        b"what this spread passes".to_vec(),
                        why,
                        b"Pass the argument on its own.".to_vec(),
                    ],
                ));
                break;
            } else if let Some(&argument) = arguments.get(index as usize) {
                self.check_int32_store(file, Store::Value(argument), place, search);
            }
        }
    }

    fn check_uses_of_functions_with_int32_parameters(&mut self, file: FileId, search: &mut Search) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.file_exprs_by_kind(file);
        let may_name_function = SymFlags::FUNCTION
            | SymFlags::CLASS
            | SymFlags::ALIAS
            | SymFlags::BLOCK_SCOPED_VARIABLE;
        let mut named: FxHashMap<SymbolId, Option<(FileId, FnId)>> = FxHashMap::default();
        for &e in by_kind.of(ExprTag::Ident) {
            let Some(local) = bound.expr_symbol[e.idx()].some() else {
                continue;
            };
            let symbol = &bound.symbols[local.idx()];
            if !symbol.flags.intersects(may_name_function) {
                continue;
            }
            let is_initialized_with_function = |pat: crate::hir::PatId| matches!(bound.pat_parent[pat.idx()], PatParent::Var(d) if hir[d].init.is_some() && matches!(hir[hir[d].init].kind, ExprKind::Fn(_)));
            if !symbol
                .flags
                .intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ALIAS)
                && !matches!(symbol.decls.as_slice(), [Decl::Var(pat)] if is_initialized_with_function(*pat))
            {
                continue;
            }
            let is_called = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee == e));
            if is_called || bound.is_unchecked(e.idx()) || bound.is_in_type_query(e) {
                continue;
            }
            if matches!(
                symbol.decls.as_slice(),
                [Decl::ImportNamespace(_) | Decl::ImportEquals(_) | Decl::Require(_)]
            ) {
                let is_object_of_access = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::Dot { obj, .. } if obj == e));
                let held = self.type_of_expr(file, e);
                if is_object_of_access
                    || self.check_functions_held_by_module_object(file, e, held, search)
                {
                    continue;
                }
            }
            let function = match named.get(&local) {
                Some(&known) => known,
                None => {
                    let function = self
                        .function_for_syntax(file, e)
                        .filter(|&function| !self.int32_parameters(function, search).is_empty());
                    named.insert(local, function);
                    function
                }
            };
            let Some((of, func)) = function else { continue };
            let is_class = self.hir(of)[func].kind == FnKind::Constructor;
            let is_harmless = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Dot { obj, .. } if obj == e => {
                        is_class
                            || self.check_int32_arguments_of_bind(file, parent, (of, func), search)
                    }
                    ExprKind::Binary {
                        op: BinOp::Instanceof,
                        right,
                        ..
                    } => is_class && right == e,
                    ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) => {
                        self.is_called_through_assertions(file, parent, (of, func), search)
                    }
                    _ => false,
                },
                Parent::ClassExtends(_) => is_class,
                Parent::Stmt(stmt) if stmt.is_some() => matches!(
                    hir[stmt].kind,
                    StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                ),
                _ => false,
            };
            if !is_harmless {
                self.report_function_used_as_value(file, e, (of, func), search);
            }
        }
        for &e in by_kind.of(ExprTag::ImportCall) {
            let promised = self.type_of_expr(file, e);
            let module_object = self.awaited(promised);
            self.check_functions_held_by_module_object(file, e, module_object, search);
        }
        for &e in by_kind.of(ExprTag::Call) {
            let is_held_by_name = matches!(bound.expr_parent[e.idx()], Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)));
            if crate::bind::required_specifier(hir, e).is_some() && !is_held_by_name {
                let module_object = self.type_of_expr(file, e);
                self.check_functions_held_by_module_object(file, e, module_object, search);
            }
        }
        if self.is_untyped_file(file) {
            return;
        }
        for &e in by_kind.of(ExprTag::Dot) {
            let is_called = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::Call(call) if hir[call].callee == e));
            if is_called
                || bound.is_unchecked(e.idx())
                || bound.is_in_type_query(e)
                || bound.get_assignment_target(hir, e).is_some()
            {
                continue;
            }
            let ty = self.type_of_expr(file, e);
            let TypeData::Fns { decls, .. } = self.data(ty) else {
                continue;
            };
            let Some(&(of, declared)) = decls.first() else {
                continue;
            };
            if !matches!(self.bound(of).fns[declared.idx()].owner, FnOwner::Member(_)) {
                continue;
            }
            let function = self
                .implementation_for(of, declared)
                .unwrap_or((of, declared));
            if !self.int32_parameters(function, search).is_empty() {
                self.report_function_used_as_value(file, e, function, search);
            }
        }
        for func in (0..hir.fns.len() as u32).map(FnId) {
            let FnOwner::Expr(e) = bound.fns[func.idx()].owner else {
                continue;
            };
            if hir[func].params.is_empty()
                || self.int32_parameters((file, func), search).is_empty()
                || bound.is_unchecked(e.idx())
            {
                continue;
            }
            let is_harmless = match bound.expr_parent[e.idx()] {
                Parent::VarInit(d) => {
                    hir[d].kind == VarKind::Const
                        && hir[d].ty.is_none()
                        && matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
                }
                Parent::Expr(parent) if parent.is_some() => {
                    matches!(hir[parent].kind, ExprKind::Call(call) if hir[call].callee == e)
                }
                _ => false,
            };
            if !is_harmless {
                self.report_function_used_as_value(file, e, (file, func), search);
            }
        }
    }

    fn check_functions_held_by_module_object(
        &mut self,
        file: FileId,
        e: ExprId,
        module_object: TypeId,
        search: &mut Search,
    ) -> bool {
        if !matches!(
            self.data(module_object),
            TypeData::Anon {
                origin: Origin::Module(_) | Origin::Namespace { .. },
                ..
            }
        ) {
            return false;
        }
        for prop in self.properties_of_type(module_object) {
            let PropSource::Symbol(sym) = &prop.source else {
                continue;
            };
            if let Some(function) = self.function_declared_by(*sym)
                && !self.int32_parameters(function, search).is_empty()
            {
                self.report_function_used_as_value(file, e, function, search);
            }
        }
        true
    }

    fn function_declared_by(&mut self, sym: Sym) -> Option<(FileId, FnId)> {
        let sym = if self.files().flags(sym).contains(SymFlags::ALIAS) {
            self.files().resolve_alias(sym)?
        } else {
            sym
        };
        match self.files().value_declaration(sym)? {
            (of, Decl::Fn(func)) => self.implementation_for(of, func),
            (of, Decl::Class(class)) => {
                let hir = self.hir(of);
                hir[class]
                    .members
                    .iter()
                    .map(|member| &hir[member])
                    .find(|m| {
                        m.kind == MemberKind::Constructor
                            && !matches!(hir[m.func].body, FnBody::None)
                    })
                    .map(|m| (of, m.func))
            }
            (of, Decl::Var(pat)) => {
                let PatParent::Var(d) = self.bound(of).pat_parent[pat.idx()] else {
                    return None;
                };
                match self.hir(of)[self.hir(of)[d].init.some()?].kind {
                    ExprKind::Fn(func) => Some((of, func)),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn is_called_through_assertions(
        &mut self,
        file: FileId,
        mut asserted: ExprId,
        function: (FileId, FnId),
        search: &mut Search,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let Parent::Expr(parent) = bound.expr_parent[asserted.idx()] else {
                return false;
            };
            let Some(parent) = parent.some() else {
                return false;
            };
            match hir[parent].kind {
                ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) => {
                    asserted = parent
                }
                ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee == asserted => {
                    let Some(called_as) = self.called_function(file, parent) else {
                        return false;
                    };
                    let checked = self.int32_parameters(called_as, search).clone();
                    return self
                        .int32_parameters(function, search)
                        .iter()
                        .all(|index| checked.contains(index));
                }
                _ => return false,
            }
        }
    }

    fn check_int32_arguments_of_bind(
        &mut self,
        file: FileId,
        member: ExprId,
        function: (FileId, FnId),
        search: &mut Search,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[member.idx()] else {
            return false;
        };
        let (ExprKind::Dot { name, .. }, Some(parent)) = (hir[member].kind, parent.some()) else {
            return false;
        };
        let ExprKind::Call(call) = hir[parent].kind else {
            return false;
        };
        if hir[call].callee != member
            || self.atoms().bytes(name) != b"bind"
            || self.is_untyped_file(file)
        {
            return false;
        }
        let Some((declared_in, ..)) = self
            .resolved_signature(file, parent)
            .sig
            .and_then(|sig| self.sig_decl(sig))
        else {
            return false;
        };
        let given: SmallVec<[ExprId; 8]> = hir.ids(hir[call].args).skip(1).collect();
        let indices = self.int32_parameters(function, search).clone();
        if !self.files().module(declared_in).is_lib
            || given
                .iter()
                .any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
            || indices.iter().any(|&index| index as usize >= given.len())
        {
            return false;
        }
        for index in indices {
            let place = Int32Place::Parameter(
                function.0,
                function.1,
                self.hir(function.0)[function.1].params.at(index as usize),
            );
            self.check_int32_store(file, Store::Value(given[index as usize]), place, search);
        }
        true
    }

    fn report_function_used_as_value(
        &mut self,
        file: FileId,
        e: ExprId,
        (of, func): (FileId, FnId),
        search: &mut Search,
    ) {
        let index = self.int32_parameters((of, func), search)[0];
        let p = self.hir(of)[func].params.at(index as usize);
        let parameter = self.describe_int32_place(Int32Place::Parameter(of, func, p));
        let hir = self.hir(file);
        if let ExprKind::Fn(_) = hir[e].kind {
            let (start, end) = (self.hir(of)[p].pos, self.hir(of)[p].loc.end);
            return search.found.push(CompilerDiagnostic {
                file,
                start,
                end,
                code: USED_AS_A_VALUE,
                args: vec![parameter],
                related: Vec::new(),
            });
        }
        let related = vec![self.finding_at(
            Place {
                file: of,
                pos: self.hir(of)[p].pos,
            },
            DECLARED_HERE,
            vec![self.parameter_name(of, p)],
        )];
        search.found.push(CompilerDiagnostic {
            related,
            ..self.finding_over(file, e, USED_AS_A_VALUE, vec![parameter])
        });
    }

    fn parameter_name(&self, file: FileId, p: ParamId) -> Vec<u8> {
        let hir = self.hir(file);
        match hir[hir[p].pat].kind {
            PatKind::Ident(name) => self.atoms().bytes(name).to_vec(),
            _ => b"it".to_vec(),
        }
    }

    fn function_display_name(&self, file: FileId, func: FnId) -> Option<Vec<u8>> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let name = if let FnOwner::Member(member) = bound.fns[func.idx()].owner
            && hir[member].kind == MemberKind::Constructor
        {
            match bound.member_owner[member.idx()] {
                MemberOwner::Class(class) => Some(hir[class].name),
                _ => None,
            }
        } else if hir[func].name.is_some() {
            Some(hir[func].name)
        } else {
            match bound.fns[func.idx()].owner {
                FnOwner::Member(member) => self.known_member_name(file, hir[member].key),
                FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                    Parent::VarInit(d) => match hir[hir[d].pat].kind {
                        PatKind::Ident(name) => Some(name),
                        _ => None,
                    },
                    _ => None,
                },
                _ => None,
            }
        };
        name.filter(|name| name.is_some())
            .map(|name| self.atoms().bytes(name).to_vec())
    }

    fn describe_int32_place(&mut self, place: Int32Place) -> Vec<u8> {
        match place {
            Int32Place::Variable(name) => quoted(self.atoms().bytes(name)),
            Int32Place::Parameter(file, func, p) => {
                let name = self.parameter_name(file, p);
                match self.function_display_name(file, func) {
                    Some(function) => {
                        [b"Parameter '", &name[..], b"' of '", &function[..], b"'"].concat()
                    }
                    None => [b"Parameter '", &name[..], b"'"].concat(),
                }
            }
            Int32Place::Property(sym) => {
                let name = self.atoms().bytes(self.files().symbol(sym).name);
                match self
                    .declaring_container_name(sym)
                    .filter(|container| container.is_some())
                {
                    Some(container) => [
                        b"Property '",
                        name,
                        b"' of '",
                        self.atoms().bytes(container),
                        b"'",
                    ]
                    .concat(),
                    None => [b"Property '", name, b"'"].concat(),
                }
            }
            Int32Place::Result(file, func) => match self.function_display_name(file, func) {
                Some(function) => [b"The result of '", &function[..], b"'"].concat(),
                None => b"The result of this function".to_vec(),
            },
        }
    }

    fn finding_over(
        &self,
        file: FileId,
        e: ExprId,
        code: u32,
        args: Vec<Vec<u8>>,
    ) -> CompilerDiagnostic {
        let hir = self.hir(file);
        CompilerDiagnostic {
            file,
            start: hir[e].pos,
            end: hir[e].end,
            code,
            args,
            related: Vec::new(),
        }
    }

    fn source_of(&self, file: FileId, e: ExprId) -> Option<&'p [u8]> {
        let hir = self.hir(file);
        let text: &[u8] = hir.text.get(hir[e].pos as usize..hir[e].end as usize)?;
        (text.len() <= MAX_QUOTED_LENGTH && !text.contains(&b'\n')).then_some(text)
    }

    fn quoted_source(&self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        self.source_of(file, e).map(quoted)
    }

    fn check_int32_store(
        &mut self,
        file: FileId,
        store: Store,
        place: Int32Place,
        search: &mut Search,
    ) {
        let (Store::Value(e) | Store::Computed(e)) = store else {
            return;
        };
        if self.bound(file).is_unchecked(e.idx()) {
            return;
        }
        let Int32Proof::Unproven {
            range,
            may_be_nullish,
        } = self.int32_proof(file, store)
        else {
            return;
        };
        let what = self.describe_int32_place(place);
        let text = self
            .quoted_source(file, e)
            .unwrap_or_else(|| b"this value".to_vec());
        if let Store::Value(_) = store
            && let Some(Primitive::Number(value)) = self.constant_value_of(file, e)
        {
            let why: &[u8] = if value.is_nan() {
                b"it is NaN"
            } else if value.fract() != 0.0 {
                b"it has a fraction"
            } else if value == 0.0 {
                b"it is -0"
            } else {
                b"an int32 is a whole number from -2147483648 to 2147483647"
            };
            return search.found.push(self.finding_over(
                file,
                e,
                NOT_AN_INT32,
                vec![what, text, why.to_vec()],
            ));
        }
        let why = self.describe_unproven_int32(file, store, range, may_be_nullish);
        let fix = self.int32_conversion_for(file, store);
        search
            .found
            .push(self.finding_over(file, e, UNPROVEN, vec![what, text, why, fix]));
    }

    fn describe_unproven_int32(
        &mut self,
        file: FileId,
        store: Store,
        range: Option<(i64, i64)>,
        may_be_nullish: bool,
    ) -> Vec<u8> {
        let (Store::Value(e) | Store::Computed(e)) = store else {
            return Vec::new();
        };
        let hir = self.hir(file);
        if let Some((minimum, maximum)) = range {
            let is_within = minimum >= INT32.0 && maximum <= INT32.1;
            return match (is_within, may_be_nullish) {
                (true, _) if matches!(hir[e].kind, ExprKind::Index { .. }) => {
                    b"an index that is out of range reads undefined".to_vec()
                }
                (true, _) => b"it can be undefined".to_vec(),
                (false, false) => {
                    format!("it can be anything from {minimum} to {maximum}").into_bytes()
                }
                (false, true) => {
                    format!("it can be anything from {minimum} to {maximum}, or undefined")
                        .into_bytes()
                }
            };
        }
        let operator = match (store, hir[e].kind) {
            (Store::Value(_), ExprKind::Binary { op, .. })
            | (Store::Computed(_), ExprKind::Assign { op: Some(op), .. }) => Some(op),
            _ => None,
        };
        match operator {
            Some(BinOp::Div) => return b"a division can leave a fraction".to_vec(),
            Some(BinOp::Mul) => {
                return b"a product can be too large to be exact, and it can be -0".to_vec();
            }
            Some(BinOp::Rem) => return b"a remainder can be -0 or NaN".to_vec(),
            Some(BinOp::Pow) => return b"a power can be out of range or have a fraction".to_vec(),
            _ => {}
        }
        if let (
            Store::Value(_),
            ExprKind::Unary {
                op: UnOp::Minus, ..
            },
        ) = (store, hir[e].kind)
        {
            return b"the negative of 0 is -0, which is not an int32".to_vec();
        }
        if self.is_untyped_file(file) {
            return b"nothing is known about it".to_vec();
        }
        let ty = self.type_of_expr(file, e);
        if self.is_uninformative(ty) {
            return [b"its type is '", self.display_name(ty).as_bytes(), b"'"].concat();
        }
        b"all that is known is that it is a 'number', which can have a fraction, be out of range, or be NaN or -0".to_vec()
    }

    fn int32_conversion_for(&mut self, file: FileId, store: Store) -> Vec<u8> {
        let hir = self.hir(file);
        let is_compound = |e: ExprId| {
            matches!(
                hir[e].kind,
                ExprKind::Binary { .. }
                    | ExprKind::Cond { .. }
                    | ExprKind::Assign { .. }
                    | ExprKind::Yield { .. }
                    | ExprKind::Await(_)
                    | ExprKind::As { .. }
                    | ExprKind::Satisfies { .. }
                    | ExprKind::Fn(_)
            )
        };
        let updated = |c: &Self, target: ExprId, sign: &str, operand: &[u8]| {
            let target = c.source_of(file, target)?;
            Some(
                [
                    b"Write '",
                    target,
                    b" = (",
                    target,
                    b" ",
                    sign.as_bytes(),
                    b" ",
                    operand,
                    b") | 0'.",
                ]
                .concat(),
            )
        };
        let written = match store {
            Store::Computed(e) => match hir[e].kind {
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PostInc,
                    operand,
                } => updated(self, operand, "+", b"1"),
                ExprKind::Unary {
                    op: UnOp::PreDec | UnOp::PostDec,
                    operand,
                } => updated(self, operand, "-", b"1"),
                ExprKind::Assign {
                    op: Some(BinOp::Mul),
                    target,
                    value,
                } => self
                    .source_of(file, target)
                    .zip(self.source_of(file, value))
                    .map(|(target, value)| {
                        [
                            b"Write '",
                            target,
                            b" = Math.imul(",
                            target,
                            b", ",
                            value,
                            b")'.",
                        ]
                        .concat()
                    }),
                ExprKind::Assign {
                    op: Some(op),
                    target,
                    value,
                } => {
                    let sign = match op {
                        BinOp::Add => Some("+"),
                        BinOp::Sub => Some("-"),
                        BinOp::Div => Some("/"),
                        BinOp::Rem => Some("%"),
                        BinOp::Pow => Some("**"),
                        BinOp::UShr => Some(">>>"),
                        _ => None,
                    };
                    let operand = self.source_of(file, value).map(|text| {
                        if is_compound(value) {
                            [b"(", text, b")"].concat()
                        } else {
                            text.to_vec()
                        }
                    });
                    sign.zip(operand)
                        .and_then(|(sign, operand)| updated(self, target, sign, &operand))
                }
                _ => None,
            },
            Store::Value(e) => match hir[e].kind {
                ExprKind::Binary {
                    op: BinOp::Mul,
                    left,
                    right,
                } => self
                    .source_of(file, left)
                    .zip(self.source_of(file, right))
                    .map(|(left, right)| {
                        [b"Write 'Math.imul(", left, b", ", right, b")'."].concat()
                    }),
                _ if is_compound(e) => self
                    .source_of(file, e)
                    .map(|text| [b"Write '(", text, b") | 0'."].concat()),
                _ => self
                    .source_of(file, e)
                    .map(|text| [b"Write '", text, b" | 0'."].concat()),
            },
            Store::Nil => None,
        };
        written.unwrap_or_else(|| b"Convert it with '| 0'.".to_vec())
    }
}
