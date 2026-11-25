//! Statements of a declaration file that another thread has parsed into a file of their own. Appending them gives the
//! lists that parsing them in place gives.

use super::*;
use crate::util::InParallel;
use bun_threading::Guarded;
use std::mem::MaybeUninit;

/// What an element of `FileIn::ids` is.
#[derive(Copy, Clone, PartialEq, Eq)]
enum IdOf {
    Unknown,
    Expr,
    Stmt,
    Type,
    /// The start of a list in `ids`.
    List,
    /// An atom or a length.
    Nothing,
}

/// Consecutive statements of one list.
pub struct Stretch {
    nodes: Box<FileBuilder>,
    statements: Vec<StmtId>,
    /// Parallel to `nodes.ids`.
    ids: Vec<IdOf>,
}

trait Moves: Copy {
    fn moved(self, by: &Shift) -> Self;
}

trait Indexes {
    fn shift(by: &Shift) -> u32;
}

macro_rules! lists {
    ($($list:ident: $node:ty $(=> $id:ident)? $(, after $placeholder:expr)?;)*) => {
        /// What to add to an index into each list.
        #[derive(Copy, Clone)]
        struct Shift {
            ids: u32,
            $($list: u32,)*
        }

        /// Where the nodes of a stretch go.
        struct Room<'a> {
            ids: &'a mut [MaybeUninit<u32>],
            $($list: &'a mut [MaybeUninit<$node>],)*
        }

        $($(
            impl Indexes for $id {
                #[inline(always)]
                fn shift(by: &Shift) -> u32 {
                    by.$list
                }
            }
            impl Moves for $id {
                #[inline(always)]
                fn moved(self, by: &Shift) -> Self {
                    match self.is_some() {
                        true => $id(self.0.wrapping_add(by.$list)),
                        false => self,
                    }
                }
            }
        )?)*

        /// How many placeholders each list begins with.
        const PLACEHOLDERS: Shift = Shift {
            ids: 1,
            $($list: lists!(@count $($placeholder)?),)*
        };

        impl Stretch {
            /// Call on an empty file before the statements are parsed into it. An empty `Span` or `IdList` starts at 0
            /// or at the length of its list. With a placeholder in the list the two can be told apart.
            pub fn begin(file: &mut FileBuilder) {
                file.ids.push(0);
                $($(file.$list.push($placeholder);)?)*
            }

            fn move_to(&self, room: Room<'_>, by: &Shift) {
                let ids = self.nodes.ids.iter().zip(&self.ids).skip(1);
                for (to, (&id, &of)) in room.ids.iter_mut().zip(ids) {
                    to.write(match of {
                        IdOf::Expr => ExprId(id).moved(by).0,
                        IdOf::Stmt => StmtId(id).moved(by).0,
                        IdOf::Type => TypeNodeId(id).moved(by).0,
                        IdOf::List => id.wrapping_add(by.ids),
                        IdOf::Nothing | IdOf::Unknown => id,
                    });
                }
                $(
                    let nodes = &self.nodes.$list[PLACEHOLDERS.$list as usize..];
                    bun_alloc::prefault(room.$list);
                    for (to, node) in room.$list.iter_mut().zip(nodes) {
                        to.write(node.moved(by));
                    }
                )*
            }
        }

        impl FileBuilder {
            /// Returns the `Shift` of each.
            fn append_lists(&mut self, stretches: &[Stretch], in_parallel: InParallel<'_>) -> Vec<Shift> {
                let mut end = Shift {
                    ids: self.ids.len() as u32,
                    $($list: self.$list.len() as u32,)*
                };
                let shifts: Vec<Shift> = (stretches.iter())
                    .map(|it| {
                        let shift = Shift {
                            ids: end.ids.wrapping_sub(PLACEHOLDERS.ids),
                            $($list: end.$list.wrapping_sub(PLACEHOLDERS.$list),)*
                        };
                        end = Shift {
                            ids: shift.ids.wrapping_add(it.nodes.ids.len() as u32),
                            $($list: shift.$list.wrapping_add(it.nodes.$list.len() as u32),)*
                        };
                        shift
                    })
                    .collect();
                let mut left = Room {
                    ids: room_up_to(&mut self.ids, end.ids),
                    $($list: room_up_to(&mut self.$list, end.$list),)*
                };
                let rooms: Vec<Guarded<Option<Room<'_>>>> = (stretches.iter())
                    .map(|it| {
                        Guarded::new(Some(Room {
                            ids: take_first(&mut left.ids, it.nodes.ids.len() - PLACEHOLDERS.ids as usize),
                            $($list: take_first(
                                &mut left.$list,
                                it.nodes.$list.len() - PLACEHOLDERS.$list as usize,
                            ),)*
                        }))
                    })
                    .collect();
                in_parallel(stretches.len(), &|at| {
                    let room = rooms[at].lock().take();
                    stretches[at].move_to(room.expect("once for each"), &shifts[at]);
                });
                assert!(rooms.iter().all(|it| it.lock().is_none()));
                drop(rooms);
                // SAFETY: the rooms are what lies between the two lengths, and `move_to` has written each of them whole.
                unsafe {
                    self.ids.set_len(end.ids as usize);
                    $(self.$list.set_len(end.$list as usize);)*
                }
                shifts
            }
        }
    };
    (@count) => { 0 };
    (@count $placeholder:expr) => { 1 };
}

fn room_up_to<T>(list: &mut Vec<T>, end: u32) -> &mut [MaybeUninit<T>] {
    let more = end as usize - list.len();
    if list.capacity() < end as usize {
        // `reserve` would copy the whole block, which makes all of it resident.
        let mut larger = Vec::with_capacity((end as usize).max(2 * list.capacity()));
        larger.append(list);
        *list = larger;
    }
    &mut list.spare_capacity_mut()[..more]
}

fn take_first<'a, T>(left: &mut &'a mut [T], len: usize) -> &'a mut [T] {
    let (first, rest) = std::mem::take(left).split_at_mut(len);
    *left = rest;
    first
}

const NOWHERE: TextRange = TextRange { pos: 0, end: 0 };

lists! {
    exprs: Expr => ExprId;
    stmts: Stmt => StmtId;
    types: TypeNode => TypeNodeId;
    pats: Pat => PatId;
    fns: Func => FnId;
    classes: Class => ClassId;
    interfaces: Interface => InterfaceId;
    aliases: Alias => AliasId;
    enums: Enum => EnumId;
    modules: Module => ModuleId;
    imports: Import => ImportId;
    import_equals: ImportEquals => ImportEqualsId;
    exports: Export => ExportId;
    mapped: Mapped => MappedId;
    pat_props: PatProp => PatPropId, after PatProp {
        key: PropKey::None,
        name_kind: NameKind::Identifier,
        value: PatId::NONE,
        default: ExprId::NONE,
        is_rest: false,
        pos: 0,
        key_pos: 0,
        end: 0,
    };
    pat_elems: PatElem => PatElemId, after PatElem {
        pat: PatId::NONE,
        default: ExprId::NONE,
        is_rest: false,
        start: 0,
        end: 0,
    };
    params: Param => ParamId, after Param {
        pat: PatId::NONE,
        ty: TypeNodeId::NONE,
        default: ExprId::NONE,
        flags: Flags::empty(),
        pos: 0,
        loc: NOWHERE,
    };
    type_params: TypeParam => TypeParamId, after TypeParam {
        name: Atom::NONE,
        pos: 0,
        start: 0,
        end: 0,
        constraint: TypeNodeId::NONE,
        default: TypeNodeId::NONE,
        flags: Flags::empty(),
        modifiers: Span::EMPTY,
    };
    enum_members: EnumMember => EnumMemberId, after EnumMember {
        name: Atom::NONE,
        name_kind: NameKind::Identifier,
        computed_name: ExprId::NONE,
        init: ExprId::NONE,
        pos: 0,
        loc: NOWHERE,
    };
    members: Member => MemberId, after Member {
        kind: MemberKind::Property,
        key: PropKey::None,
        flags: Flags::empty(),
        ty: TypeNodeId::NONE,
        init: ExprId::NONE,
        func: FnId::NONE,
        name_pos: 0,
        start: 0,
        loc: NOWHERE,
        modifiers: Span::EMPTY,
    };
    var_decls: VarDecl => VarDeclId, after VarDecl {
        pat: PatId::NONE,
        ty: TypeNodeId::NONE,
        init: ExprId::NONE,
        kind: VarKind::Var,
        flags: Flags::empty(),
        loc: NOWHERE,
    };
    import_specs: ImportSpec => ImportSpecId, after ImportSpec {
        start: 0,
        imported: Atom::NONE,
        local: Atom::NONE,
        pos: 0,
        type_only: false,
        imported_pos: 0,
        end: 0,
        import: ImportId::NONE,
    };
    export_specs: ExportSpec => ExportSpecId, after ExportSpec {
        start: 0,
        local: Atom::NONE,
        exported: Atom::NONE,
        pos: 0,
        type_only: false,
        local_pos: 0,
        end: 0,
        export: ExportId::NONE,
    };
    tuple_elems: TupleElem => TupleElemId, after TupleElem {
        ty: TypeNodeId::NONE,
        written: TypeNodeId::NONE,
        member_type: TupleMemberType::Plain,
        name: Atom::NONE,
        optional: false,
        rest: false,
        has_dots: false,
        start: 0,
        end: 0,
    };
    modifiers: Modifier => ModifierId, after Modifier {
        kind: ModifierKind::Keyword(Flags::empty()),
        pos: 0,
    };
    names: Name => NameId, after Name {
        text: Atom::NONE,
        packed_pos: 0,
    };
    numbers: f64;
    expr_flags: ExprFlags;
    specifier_uses: SpecifierUse;
    keyword_identifier_positions: u32;
    bigint_names: (u32, Atom);
    parens: (ExprId, u32, u32);
    modifiers_of_stmts: (StmtId, Span<ModifierId>);
}

impl<T: Indexes> Moves for Span<T> {
    #[inline(always)]
    fn moved(self, by: &Shift) -> Self {
        match self.start {
            0 => self,
            start => Span::new(start.wrapping_add(T::shift(by)), self.len),
        }
    }
}

impl<T> Moves for IdList<T> {
    #[inline(always)]
    fn moved(self, by: &Shift) -> Self {
        match self.start {
            0 => self,
            start => IdList::new(start.wrapping_add(by.ids), self.len),
        }
    }
}

impl<T> Moves for ListAt<T> {
    fn moved(self, by: &Shift) -> Self {
        match self.is_empty() {
            true => self,
            false => ListAt {
                at: self.at.wrapping_add(by.ids),
                _of: PhantomData,
            },
        }
    }
}

macro_rules! stay {
    ($($it:ty),*) => {$(
        impl Moves for $it {
            #[inline(always)]
            fn moved(self, _: &Shift) -> Self {
                self
            }
        }
    )*};
}
stay!(f64, u32, ExprFlags, (u32, Atom));

impl Moves for (ExprId, u32, u32) {
    fn moved(self, by: &Shift) -> Self {
        (self.0.moved(by), self.1, self.2)
    }
}

impl Moves for (StmtId, Span<ModifierId>) {
    #[inline(always)]
    fn moved(self, by: &Shift) -> Self {
        (self.0.moved(by), self.1.moved(by))
    }
}

/// The fields that refer to nodes, and then all the others: a new field doesn't compile until it's one of the two.
macro_rules! fields {
    ($($node:ident { $($moves:ident),*; $($stays:ident),* })*) => {$(
        impl Moves for $node {
            #[inline(always)]
            fn moved(self, _by: &Shift) -> Self {
                let $node { $($moves,)* $($stays,)* } = self;
                $node { $($moves: $moves.moved(_by),)* $($stays,)* }
            }
        }
    )*};
}

fields! {
    Expr { kind; pos, end }
    Stmt { kind; start, loc }
    TypeNode { kind; pos, end }
    Pat { kind; pos, end }
    Func {
        type_params, params, this_param, ret, body;
        kind, flags, name, name_pos, anchor, start, text_start, is_strict, is_strict_by_syntax
    }
    Class {
        type_params, extends, extends_args, other_extends, implements, other_implements, members, modifiers;
        name, name_pos, flags, start, text_start
    }
    Interface { type_params, extends, other_heritage, members, stmt; name, name_pos, flags }
    Alias { type_params, ty, stmt; name, name_pos, flags }
    Enum { members, stmt; name, name_pos, flags }
    Module { body, stmt; name, name_pos, flags, has_body, specifies_module, is_erased }
    Import {
        named, stmt, attributes;
        spec, default, default_pos, namespace, namespace_pos, clause_start, clause_end, namespace_start,
        has_named_imports, type_only, is_deferred, mode, loaded_as
    }
    ImportEquals { target, expression, stmt; name, name_pos, flags }
    Export { items, stmt, attributes; spec, has_module_specifier, type_only, mode }
    Mapped {
        param, name_ty, ty, members;
        readonly, optional, is_readonly_with_plus, is_optional_with_plus
    }
    PatProp { key, value, default; name_kind, is_rest, pos, key_pos, end }
    PatElem { pat, default; is_rest, start, end }
    Param { pat, ty, default; flags, pos, loc }
    TypeParam { constraint, default, modifiers; name, pos, start, end, flags }
    EnumMember { computed_name, init; name, name_kind, pos, loc }
    Member { key, ty, init, func, modifiers; kind, flags, name_pos, start, loc }
    VarDecl { pat, ty, init; kind, flags, loc }
    ImportSpec { import; start, imported, local, pos, type_only, imported_pos, end }
    ExportSpec { export; start, local, exported, pos, type_only, local_pos, end }
    TupleElem { ty, written; member_type, name, optional, rest, has_dots, start, end }
    Modifier { kind; pos }
    Name { ; text, packed_pos }
    SpecifierUse { ; spec, pos, kind, mode }
}

impl Moves for PropKey {
    #[inline(always)]
    fn moved(self, by: &Shift) -> Self {
        match self {
            PropKey::None | PropKey::Name(_) | PropKey::Private(_) => self,
            PropKey::Computed(e) => PropKey::Computed(e.moved(by)),
        }
    }
}

impl Moves for ModifierKind {
    #[inline(always)]
    fn moved(self, by: &Shift) -> Self {
        match self {
            ModifierKind::Keyword(_) => self,
            ModifierKind::Decorator(e) => ModifierKind::Decorator(e.moved(by)),
        }
    }
}

impl Moves for PatKind {
    #[inline(always)]
    fn moved(self, by: &Shift) -> Self {
        match self {
            PatKind::Missing | PatKind::Ident(_) => self,
            PatKind::Object(props) => PatKind::Object(props.moved(by)),
            PatKind::Array(elems) => PatKind::Array(elems.moved(by)),
        }
    }
}

impl Moves for ImportEqualsTarget {
    fn moved(self, by: &Shift) -> Self {
        match self {
            ImportEqualsTarget::Require(_) => self,
            ImportEqualsTarget::Entity(names) => ImportEqualsTarget::Entity(names.moved(by)),
        }
    }
}

impl Moves for FnBody {
    #[inline(always)]
    fn moved(self, _: &Shift) -> Self {
        debug_assert!(matches!(self, FnBody::None));
        self
    }
}

impl Moves for TypeNodeKind {
    #[inline(always)]
    fn moved(self, by: &Shift) -> Self {
        use TypeNodeKind as K;
        match self {
            K::Error
            | K::Keyword(_)
            | K::StringLit(_)
            | K::BigIntLit {
                text: _,
                negative: _,
            }
            | K::BoolLit(_)
            | K::UniqueSymbol => self,
            K::Heritage { expr, args } => K::Heritage {
                expr: expr.moved(by),
                args: args.moved(by),
            },
            K::Ref { name, args } => K::Ref {
                name: name.moved(by),
                args: args.moved(by),
            },
            K::NumberLit(number) => K::NumberLit(number + by.numbers),
            K::Template { types, texts } => K::Template {
                types: types.moved(by),
                texts: texts.moved(by),
            },
            K::Array(ty) => K::Array(ty.moved(by)),
            K::Tuple(elems) => K::Tuple(elems.moved(by)),
            K::Union(types) => K::Union(types.moved(by)),
            K::Intersection(types) => K::Intersection(types.moved(by)),
            K::Fn(f) => K::Fn(f.moved(by)),
            K::Object(members) => K::Object(members.moved(by)),
            K::Cond {
                check,
                extends,
                yes,
                no,
            } => K::Cond {
                check: check.moved(by),
                extends: extends.moved(by),
                yes: yes.moved(by),
                no: no.moved(by),
            },
            K::Infer(param) => K::Infer(param.moved(by)),
            K::Mapped(mapped) => K::Mapped(mapped.moved(by)),
            K::IndexedAccess { obj, index } => K::IndexedAccess {
                obj: obj.moved(by),
                index: index.moved(by),
            },
            K::Keyof(ty) => K::Keyof(ty.moved(by)),
            K::Readonly(ty) => K::Readonly(ty.moved(by)),
            K::Unique(ty) => K::Unique(ty.moved(by)),
            K::JSDoc {
                ty,
                kind,
                is_postfix,
            } => K::JSDoc {
                ty: ty.moved(by),
                kind,
                is_postfix,
            },
            K::Typeof {
                name,
                args,
                has_type_arguments,
                expr,
            } => K::Typeof {
                name: name.moved(by),
                args: args.moved(by),
                has_type_arguments,
                expr: expr.moved(by),
            },
            K::Import {
                spec,
                name,
                args,
                is_typeof,
                mode,
                attributes,
            } => K::Import {
                spec,
                name: name.moved(by),
                args: args.moved(by),
                is_typeof,
                mode,
                attributes,
            },
            K::Predicate { param, ty, asserts } => K::Predicate {
                param,
                ty: ty.moved(by),
                asserts,
            },
        }
    }
}

impl ExprKind {
    /// `None`: a stretch has no such expression.
    fn try_moved(self, by: &Shift) -> Option<ExprKind> {
        use ExprKind as K;
        Some(match self {
            K::Missing
            | K::Ident(_)
            | K::PrivateIdentifier(_)
            | K::This
            | K::Null
            | K::True
            | K::False
            | K::String(_)
            | K::BigInt(_) => self,
            K::Number(number) => K::Number(number + by.numbers),
            K::Dot {
                obj,
                name,
                chain,
                name_before_end,
            } => K::Dot {
                obj: obj.moved(by),
                name,
                chain,
                name_before_end,
            },
            K::Index { obj, index, chain } => K::Index {
                obj: obj.moved(by),
                index: index.moved(by),
                chain,
            },
            K::Unary { op, operand } => K::Unary {
                op,
                operand: operand.moved(by),
            },
            K::Binary { op, left, right } => K::Binary {
                op,
                left: left.moved(by),
                right: right.moved(by),
            },
            K::Instantiation { expr, type_args } => K::Instantiation {
                expr: expr.moved(by),
                type_args: type_args.moved(by),
            },
            _ => return None,
        })
    }
}

impl Moves for ExprKind {
    fn moved(self, by: &Shift) -> Self {
        self.try_moved(by).expect("`Stretch::new` has looked")
    }
}

impl StmtKind {
    /// `None`: a stretch has no such statement.
    fn try_moved(self, by: &Shift) -> Option<StmtKind> {
        use StmtKind as K;
        Some(match self {
            K::Empty
            | K::ExportAsNamespace(_)
            | K::ExportStar {
                spec: _,
                alias: _,
                type_only: _,
                mode: _,
                star_pos: _,
                alias_pos: _,
            } => self,
            K::Var(declarations) => K::Var(declarations.moved(by)),
            K::Fn(it) => K::Fn(it.moved(by)),
            K::Class(it) => K::Class(it.moved(by)),
            K::Interface(it) => K::Interface(it.moved(by)),
            K::TypeAlias(it) => K::TypeAlias(it.moved(by)),
            K::Enum(it) => K::Enum(it.moved(by)),
            K::Module(it) => K::Module(it.moved(by)),
            K::Import(it) => K::Import(it.moved(by)),
            K::ImportEquals(it) => K::ImportEquals(it.moved(by)),
            K::ExportNamed(it) => K::ExportNamed(it.moved(by)),
            K::ExportDefault(e) => K::ExportDefault(e.moved(by)),
            K::ExportAssign(e) => K::ExportAssign(e.moved(by)),
            _ => return None,
        })
    }
}

impl Moves for StmtKind {
    fn moved(self, by: &Shift) -> Self {
        self.try_moved(by).expect("`Stretch::new` has looked")
    }
}

/// `None` unless each element belongs to exactly one list.
fn kinds_of_ids(file: &FileBuilder) -> Option<Vec<IdOf>> {
    let mut kinds = vec![IdOf::Unknown; file.ids.len()];
    let mut is_sound = true;
    let mut mark = |range: std::ops::Range<usize>, kind: IdOf| match kinds.get_mut(range) {
        Some(all) => {
            for it in all {
                is_sound &= std::mem::replace(it, kind) == IdOf::Unknown;
            }
        }
        None => is_sound = false,
    };
    mark(0..1, IdOf::Nothing);
    for ty in &file.types {
        match ty.kind {
            TypeNodeKind::Heritage { args, .. }
            | TypeNodeKind::Ref { args, .. }
            | TypeNodeKind::Typeof { args, .. }
            | TypeNodeKind::Import { args, .. }
            | TypeNodeKind::Union(args)
            | TypeNodeKind::Intersection(args) => mark(args.range(), IdOf::Type),
            TypeNodeKind::Template { types, texts } => {
                mark(types.range(), IdOf::Type);
                mark(texts.range(), IdOf::Nothing);
            }
            _ => {}
        }
    }
    for it in &file.interfaces {
        mark(it.extends.range(), IdOf::Type);
        mark(it.other_heritage.range(), IdOf::Type);
    }
    for it in &file.modules {
        mark(it.body.range(), IdOf::Stmt);
    }
    for it in &file.classes {
        mark(it.extends_args.range(), IdOf::Type);
        mark(it.other_extends.range(), IdOf::Expr);
        mark(it.implements.range(), IdOf::Type);
        mark(it.other_implements.range(), IdOf::Type);
    }
    for it in &file.exprs {
        if let ExprKind::Instantiation { type_args, .. } = it.kind
            && !type_args.is_empty()
        {
            let at = type_args.at as usize;
            mark(file.list_at(type_args).range(), IdOf::Type);
            mark(at..at + 1, IdOf::List);
            mark(at + 1..at + 2, IdOf::Nothing);
        }
    }
    // `extends A<B>` is parsed as an `Instantiation`, which leaves its `ListAt` behind.
    for IdList { start, len, .. } in file.classes.iter().map(|it| it.extends_args) {
        let at = (start + len) as usize;
        if len > 0
            && file.ids.get(at..at + 2) == Some(&[start, len])
            && kinds[at..at + 2] == [IdOf::Unknown; 2]
        {
            kinds[at..at + 2].copy_from_slice(&[IdOf::List, IdOf::Nothing]);
        }
    }
    (is_sound && kinds.iter().all(|&it| it != IdOf::Unknown)).then_some(kinds)
}

impl Stretch {
    /// `None` if `nodes` has something that isn't a plain declaration. Its comments aren't part of the stretch.
    pub fn new(nodes: Box<FileBuilder>, statements: Vec<StmtId>) -> Option<Stretch> {
        macro_rules! are_empty {
            ($($list:ident),*) => { true $(&& $list.is_empty())* };
        }
        let FileBuilder {
            // In `lists!`.
            exprs,
            stmts,
            fns,
            types: _,
            members: _,
            ids: _,
            numbers: _,
            pats: _,
            pat_props: _,
            pat_elems: _,
            params: _,
            type_params: _,
            classes: _,
            interfaces: _,
            aliases: _,
            enums: _,
            enum_members: _,
            modules: _,
            var_decls: _,
            imports: _,
            import_specs: _,
            import_equals: _,
            exports: _,
            export_specs: _,
            tuple_elems: _,
            mapped: _,
            modifiers: _,
            names: _,
            keyword_identifier_positions: _,
            expr_flags: _,
            bigint_names: _,
            specifier_uses: _,
            parens: _,
            modifiers_of_stmts: _,
            // In `append_stretches`.
            modifiers_of_params: _,
            may_bind_a_parameter_twice: _,
            rare_syntax: _,
            // Of the whole file.
            kind: _,
            is_js: _,
            is_flow: _,
            check_directive: _,
            is_forced_module: _,
            is_script_for_project: _,
            is_script_with_code: _,
            runs_beside_loader: _,
            legacy_decorators: _,
            source_len: _,
            text: _,
            body: _,
            jsx_pragmas: _,
            bases: _,
            lazy: _,
            is_strict: _,
            is_strict_by_syntax: _,
            has_module_syntax,
            has_errors,
            ran_out_of_stack,
            has_parse_diagnostics,
            syntax_errors,
            error_pos,
            imported_requires,
            places_of_imported_requires,
            imported_constants,
            texts_of_data_files,
            imported_file_changers,
            texts_of_other_files,
            unknown_imports_of_texts,
            exports_that_others_touch,
            texts_written_by_loader,
            functions_written_by_loader,
            known_evaluations,
            replaced_evaluations,
            settled_evals,
            copied_factories,
            decorators,
            diagnostics,
            references,
            comment_directives,
            ignore_comments,
            comments,
            mentioned,
            with_bodies,
            detached_semicolons,
            body_starts,
            after_skipped,
            modifiers_of_props,
            unclosed_literals,
            stray_decorators,
            deferred_import_calls,
            import_call_type_args,
            import_attributes,
            specifier_expressions,
            exports_from_expressions,
            non_null_ends,
            far_names,
            tagged_templates,
            jsx_expressions,
            jsdoc_comments,
            jsdoc_asterisks,
            jsdoc_hosts,
            jsdoc_types,
            jsdoc_modifiers,
            jsdoc_member_comments,
            jsdoc_param_errors,
            functions_with_param_tags,
            unmatched_augments_tags,
            props,
            calls,
            cases,
            jsx,
            template_parts,
            template_part_starts,
            jsx_attribute_texts,
            export_star_attributes,
        } = &*nodes;
        let is_plain = are_empty!(
            imported_requires,
            places_of_imported_requires,
            imported_constants,
            texts_of_data_files,
            imported_file_changers,
            texts_of_other_files,
            unknown_imports_of_texts,
            exports_that_others_touch,
            texts_written_by_loader,
            functions_written_by_loader,
            known_evaluations,
            replaced_evaluations,
            settled_evals,
            copied_factories,
            decorators,
            diagnostics,
            references,
            comment_directives,
            ignore_comments,
            comments,
            mentioned,
            with_bodies,
            detached_semicolons,
            body_starts,
            after_skipped,
            modifiers_of_props,
            unclosed_literals,
            stray_decorators,
            deferred_import_calls,
            import_call_type_args,
            import_attributes,
            specifier_expressions,
            exports_from_expressions,
            non_null_ends,
            far_names,
            tagged_templates,
            jsx_expressions,
            jsdoc_comments,
            jsdoc_asterisks,
            jsdoc_hosts,
            jsdoc_types,
            jsdoc_modifiers,
            jsdoc_member_comments,
            jsdoc_param_errors,
            functions_with_param_tags,
            unmatched_augments_tags,
            props,
            calls,
            cases,
            jsx,
            template_parts,
            template_part_starts,
            jsx_attribute_texts,
            export_star_attributes
        ) && !(*has_module_syntax
            || *has_errors
            || *ran_out_of_stack
            || *has_parse_diagnostics)
            && (*syntax_errors, *error_pos) == (0, 0)
            && fns.iter().all(|it| matches!(it.body, FnBody::None))
            && (exprs.iter()).all(|it| it.kind.try_moved(&PLACEHOLDERS).is_some())
            && (stmts.iter()).all(|it| it.kind.try_moved(&PLACEHOLDERS).is_some());
        Some(Stretch {
            ids: kinds_of_ids(&nodes).filter(|_| is_plain)?,
            nodes,
            statements,
        })
    }
}

impl FileBuilder {
    /// Appends the nodes of `stretches`, which follow each other in the text. Returns their statements.
    pub fn append_stretches(
        &mut self,
        stretches: &[Stretch],
        in_parallel: InParallel<'_>,
    ) -> Vec<StmtId> {
        let shifts = self.append_lists(stretches, in_parallel);
        let mut statements =
            Vec::with_capacity(stretches.iter().map(|it| it.statements.len()).sum());
        for (stretch, by) in stretches.iter().zip(&shifts) {
            statements.extend(stretch.statements.iter().map(|it| it.moved(by)));
            for (param, list) in (0u32..).zip(&stretch.nodes.modifiers_of_params) {
                self.set_param_modifiers(ParamId(param).moved(by), list.moved(by));
            }
            self.may_bind_a_parameter_twice |= stretch.nodes.may_bind_a_parameter_twice;
            self.rare_syntax |= stretch.nodes.rare_syntax;
        }
        statements
    }
}
