//! A parsed and bound file that any program can take over.
//!
//! The projects of one `tsc -b`, and those that a project references, read the same declaration
//! files: the libraries and what is in `node_modules`. A `hir::File` and its `Bound` are for one
//! program, because their atoms are numbers of the interner of that program. Here the atoms are
//! numbered within the file and come with their texts, so a program gets its own copy for the price
//! of copying the lists and interning the names: nothing is read, parsed or bound.

use crate::atom::{Atom, FIXED, Intern, Interner};
use crate::bind::{
    Bound, BoundBuilder, BoundIn, DeclsIn, SymbolIn, large_table_places, nested_names_of,
};
use crate::hir::{
    Alias, ArenaFew, Call, Class, Enum, EnumMember, Export, ExportSpec, Expr, ExprKind, File,
    FileBuilder, FileIn, Func, Import, ImportEquals, ImportEqualsTarget, ImportSpec, Interface,
    JsxPragmas, Lazy, Member, Module, ModuleName, Name, Pat, PatKind, PatProp, Prop, PropKey,
    ReferenceKind, ResolutionMode, SpecifierUse, Stmt, StmtKind, Storage, TupleElem, TypeNode,
    TypeNodeKind, TypeParam,
};
use crate::session::{Arena, ArenaVec};
use crate::util::{FxBuild, FxHashMap};
use std::borrow::Cow;

/// Calls `$with` with the fields of a `FileIn`, except `text` and `lazy`. What it expands to names
/// every field, so that a new one is a compile error.
macro_rules! file_fields {
    ($with:ident) => {
        $with! {
            plain: [
                kind is_js check_directive is_module_by_decree has_module_syntax
                has_errors ran_out_of_stack legacy_decorators has_parse_diagnostics
                syntax_errors error_pos source_len body jsx_pragmas bases
            ]
            lists: [
                body_starts modifiers_of_params specifier_uses parens
                jsx_expressions ids numbers exprs stmts types pats pat_props
                pat_elems fns params type_params classes interfaces aliases members
                props var_decls calls cases imports import_specs exports
                export_specs modifiers names fn_nodes class_nodes
            ]
            few: [
                decorators references comment_directives with_bodies after_skipped
                modifiers_of_props unclosed_literals stray_decorators
                deferred_import_calls import_call_type_args import_attributes
                specifier_expressions exports_from_expressions non_null_ends
                jsdoc_comments jsdoc_asterisks jsdoc_hosts jsdoc_types
                jsdoc_modifiers functions_with_param_tags unmatched_augments_tags
                enums enum_members modules jsx import_equals tuple_elems mapped
                keyword_identifier_positions
            ]
            kept: [
                diagnostics jsdoc_member_comments jsdoc_param_errors
            ]
        }
    };
}

/// The same for a `BoundIn`, except `symbols`, and `large_tables` and `nested_names`, which are
/// computed from the numbers of the atoms.
macro_rules! bound_fields {
    ($with:ident) => {
        $with! {
            plain: [
                ran_out_of_stack file_symbol commonjs_indicator
                module_exports_property flow_places
            ]
            lists: [
                scopes tables entries ids specifiers expr_symbol expr_parent
                expr_flow stmt_parent stmt_scope type_scope type_by_alias pat_parent
                pat_symbol prop_owner member_symbol member_owner member_scope
                param_fn type_param_symbol type_param_scope fns
                requires_scope_change fn_symbol class_symbol class_owner class_scope
                interface_symbol interface_scope interface_contains_this
                alias_symbol alias_scope var_stmt assignments case_stmt stmt_flow
                case_fallthrough import_scope export_scope free_idents alias_idents
                flow flow_edges flow_shared
            ]
            few: [
                export_stars ambient_modules pattern_ambient_modules
                global_augmentations redeclarations umd_globals module_augmentations
                ambient_specifiers enum_scope module_scope enum_symbol
                enum_member_symbol enum_member_owner module_symbol
                module_instance_state unchecked_assignment_targets
                type_query_operands unchecked_exprs unchecked_types infer_positions
                expando_declarations computed_symbols hoisted_vars
                refused_decorators unused_labels import_equals_scope
                private_names_outside_class_bodies classes_of_private_names
                arguments_objects identifiers_in_parameters jsdoc_param_errors
                names_resolved_for_arguments
            ]
            maps: [
                property_symbol expr_scope private_class
            ]
        }
    };
}

pub struct SharedFile {
    /// In both, an atom from `FIXED` on is `FIXED` plus an index into `ends`.
    file: FileBuilder,
    bound: BoundBuilder,
    /// The texts of the names, one after the other.
    texts: Vec<u8>,
    /// Where each text ends.
    ends: Vec<u32>,
}

impl SharedFile {
    /// `file` and `bound` have the atoms of `atoms`. The text of the file is left out.
    pub fn new(file: &File, bound: &Bound, atoms: &dyn Intern) -> SharedFile {
        let (mut texts, mut ends) = (Vec::new(), Vec::new());
        let mut numbers: FxHashMap<Atom, u32> = FxHashMap::default();
        let mut number = |atom: Atom| {
            let number = *numbers.entry(atom).or_insert_with(|| {
                texts.extend_from_slice(atoms.bytes(atom));
                ends.push(texts.len() as u32);
                ends.len() as u32 - 1
            });
            Atom(FIXED + number)
        };
        let (mut file, mut bound) = (file_on_the_heap(file), bound_on_the_heap(bound));
        each_atom_of_file(&mut file, &mut number);
        each_atom_of_bound(&mut bound, &mut number);
        SharedFile {
            file,
            bound,
            texts,
            ends,
        }
    }

    /// The two with the atoms of `atoms`, in `arena`, which the calling thread has in the session
    /// of `atoms`.
    pub fn for_program<'s>(&self, arena: &'s Arena, atoms: &Interner<'s>) -> (File<'s>, Bound<'s>) {
        let mut start = 0;
        let names: Vec<Atom> = (self.ends.iter())
            .map(|&end| {
                let text = &self.texts[start..end as usize];
                start = end as usize;
                atoms.intern(text)
            })
            .collect();
        let mut name = |atom: Atom| {
            let name = names.get((atom.0 - FIXED) as usize);
            *name.expect("`SharedFile::new` has numbered it")
        };
        let mut file = file_in_arena(&self.file, arena, atoms);
        each_atom_of_file(&mut file, &mut name);
        let mut bound = bound_in_arena(&self.bound, arena);
        each_atom_of_bound(&mut bound, &mut name);
        let places = large_table_places(&bound.tables, &bound.entries);
        bound.large_tables.extend(places);
        let nested = nested_names_of(&bound.scopes, &bound.tables, &bound.entries);
        bound.nested_names = list_in_arena(&nested, arena);
        (file, bound)
    }
}

fn list_in_arena<'s, T: Copy>(list: &[T], arena: &'s Arena) -> ArenaVec<'s, T> {
    let mut exact = ArenaVec::new_in(arena);
    exact.reserve_exact(list.len());
    exact.extend_from_slice(list);
    exact
}

fn file_on_the_heap(file: &File) -> FileBuilder {
    macro_rules! copy {
        (plain: [$($p:ident)*] lists: [$($l:ident)*] few: [$($f:ident)*] kept: [$($k:ident)*]) => {
            FileIn {
                $($p: file.$p,)*
                $($l: file.$l.to_vec(),)*
                $($f: file.$f.to_vec(),)*
                $($k: file.$k.to_vec(),)*
                text: Cow::default(),
                lazy: (),
            }
        };
    }
    file_fields!(copy)
}

fn file_in_arena<'s>(file: &FileBuilder, arena: &'s Arena, atoms: &Interner<'s>) -> File<'s> {
    macro_rules! copy {
        (plain: [$($p:ident)*] lists: [$($l:ident)*] few: [$($f:ident)*] kept: [$($k:ident)*]) => {
            FileIn {
                $($p: file.$p,)*
                $($l: list_in_arena(&file.$l, arena),)*
                $($f: ArenaFew::from_iter_in(file.$f.iter().copied(), arena),)*
                $($k: Cow::Owned(file.$k.clone()),)*
                text: Cow::default(),
                lazy: Lazy::new(atoms.session()),
            }
        };
    }
    file_fields!(copy)
}

fn bound_on_the_heap(bound: &Bound) -> BoundBuilder {
    let symbols = bound.symbols.iter().map(|it| SymbolIn {
        name: it.name,
        flags: it.flags,
        decls: match &it.decls {
            DeclsIn::None => DeclsIn::None,
            DeclsIn::One(decl) => DeclsIn::One(*decl),
            DeclsIn::Many(decls) => DeclsIn::Many(decls.to_vec()),
        },
        value_declaration: it.value_declaration,
        parent: it.parent,
        exports: it.exports,
        members: it.members,
        export_symbol: it.export_symbol,
    });
    macro_rules! copy {
        (plain: [$($p:ident)*] lists: [$($l:ident)*] few: [$($f:ident)*] maps: [$($m:ident)*]) => {
            BoundIn {
                $($p: bound.$p,)*
                $($l: bound.$l.to_vec(),)*
                $($f: bound.$f.to_vec(),)*
                $($m: bound.$m.iter().map(|(&key, &value)| (key, value)).collect(),)*
                this_in_type_literal: bound.this_in_type_literal.iter().copied().collect(),
                symbols: symbols.collect(),
                large_tables: Default::default(),
                nested_names: Vec::new(),
            }
        };
    }
    bound_fields!(copy)
}

/// Without `large_tables` and `nested_names`.
fn bound_in_arena<'s>(bound: &BoundBuilder, arena: &'s Arena) -> Bound<'s> {
    let mut symbols = ArenaVec::new_in(arena);
    symbols.reserve_exact(bound.symbols.len());
    symbols.extend(bound.symbols.iter().map(|it| SymbolIn {
        name: it.name,
        flags: it.flags,
        decls: match &it.decls {
            DeclsIn::None => DeclsIn::None,
            DeclsIn::One(decl) => DeclsIn::One(*decl),
            DeclsIn::Many(decls) => {
                DeclsIn::Many(ArenaFew::from_iter_in(decls.iter().copied(), arena))
            }
        },
        value_declaration: it.value_declaration,
        parent: it.parent,
        exports: it.exports,
        members: it.members,
        export_symbol: it.export_symbol,
    }));
    macro_rules! copy {
        (plain: [$($p:ident)*] lists: [$($l:ident)*] few: [$($f:ident)*] maps: [$($m:ident)*]) => {
            BoundIn {
                $($p: bound.$p,)*
                $($l: list_in_arena(&bound.$l, arena),)*
                $($f: ArenaFew::from_iter_in(bound.$f.iter().copied(), arena),)*
                $($m: {
                    let mut exact =
                        hashbrown::HashMap::with_capacity_and_hasher_in(bound.$m.len(), FxBuild, arena);
                    exact.extend(bound.$m.iter().map(|(&key, &value)| (key, value)));
                    exact
                },)*
                this_in_type_literal: {
                    let count = bound.this_in_type_literal.len();
                    let mut exact = hashbrown::HashSet::with_capacity_and_hasher_in(count, FxBuild, arena);
                    exact.extend(bound.this_in_type_literal.iter().copied());
                    exact
                },
                symbols,
                large_tables: hashbrown::HashMap::with_hasher_in(FxBuild, arena),
                nested_names: ArenaVec::new_in(arena),
            }
        };
    }
    bound_fields!(copy)
}

/// Replaces `atom` unless it is the same in all interners.
fn replace_in(atom: &mut Atom, replace: &mut dyn FnMut(Atom) -> Atom) {
    if atom.is_some() && atom.0 >= FIXED {
        *atom = replace(*atom);
    }
}

/// Replaces every atom in `bound` by what `replace` returns for it.
/// `difference_for_another_program` verifies that none is left out.
fn each_atom_of_bound<S: Storage>(bound: &mut BoundIn<S>, f: &mut dyn FnMut(Atom) -> Atom) {
    for it in bound.symbols.iter_mut() {
        replace_in(&mut it.name, f);
    }
    for it in bound.entries.iter_mut() {
        replace_in(&mut it.0, f);
    }
    for it in bound.ambient_modules.iter_mut() {
        replace_in(&mut it.0, f);
    }
    for it in bound.pattern_ambient_modules.iter_mut() {
        replace_in(&mut it.0, f);
    }
    for it in bound.umd_globals.iter_mut() {
        replace_in(&mut it.0, f);
    }
    for it in bound.specifiers.iter_mut() {
        replace_in(it, f);
    }
    for it in bound.module_augmentations.iter_mut() {
        replace_in(it, f);
    }
    for it in bound.ambient_specifiers.iter_mut() {
        replace_in(it, f);
    }
}

/// A tagged template with substitutions and its `Call::template` have one list.
fn without_duplicates(mut texts: Vec<(u32, u32)>) -> Vec<(u32, u32)> {
    texts.sort_unstable();
    texts.dedup();
    texts
}

/// The lists of a `FileIn` that have atoms, wherever they are stored.
struct ListsWithAtoms<'a> {
    jsx_pragmas: &'a mut JsxPragmas,
    calls: &'a [Call],
    references: &'a mut [(ReferenceKind, Atom, u32, ResolutionMode)],
    specifier_uses: &'a mut [SpecifierUse],
    exprs: &'a mut [Expr],
    stmts: &'a mut [Stmt],
    types: &'a mut [TypeNode],
    pats: &'a mut [Pat],
    pat_props: &'a mut [PatProp],
    members: &'a mut [Member],
    props: &'a mut [Prop],
    fns: &'a mut [Func],
    type_params: &'a mut [TypeParam],
    classes: &'a mut [Class],
    interfaces: &'a mut [Interface],
    aliases: &'a mut [Alias],
    enums: &'a mut [Enum],
    enum_members: &'a mut [EnumMember],
    modules: &'a mut [Module],
    imports: &'a mut [Import],
    import_specs: &'a mut [ImportSpec],
    import_equals: &'a mut [ImportEquals],
    exports: &'a mut [Export],
    export_specs: &'a mut [ExportSpec],
    tuple_elems: &'a mut [TupleElem],
    names: &'a mut [Name],
    ids: &'a mut [u32],
}

/// The same for `file`.
fn each_atom_of_file<S: Storage>(file: &mut FileIn<S>, f: &mut dyn FnMut(Atom) -> Atom) {
    let mut lists = ListsWithAtoms {
        jsx_pragmas: &mut file.jsx_pragmas,
        calls: &file.calls,
        references: &mut file.references,
        specifier_uses: &mut file.specifier_uses,
        exprs: &mut file.exprs,
        stmts: &mut file.stmts,
        types: &mut file.types,
        pats: &mut file.pats,
        pat_props: &mut file.pat_props,
        members: &mut file.members,
        props: &mut file.props,
        fns: &mut file.fns,
        type_params: &mut file.type_params,
        classes: &mut file.classes,
        interfaces: &mut file.interfaces,
        aliases: &mut file.aliases,
        enums: &mut file.enums,
        enum_members: &mut file.enum_members,
        modules: &mut file.modules,
        imports: &mut file.imports,
        import_specs: &mut file.import_specs,
        import_equals: &mut file.import_equals,
        exports: &mut file.exports,
        export_specs: &mut file.export_specs,
        tuple_elems: &mut file.tuple_elems,
        names: &mut file.names,
        ids: &mut file.ids,
    };
    each_atom_of_lists(&mut lists, f);
}

fn each_atom_of_lists(file: &mut ListsWithAtoms, f: &mut dyn FnMut(Atom) -> Atom) {
    let key = |key: &mut PropKey, f: &mut dyn FnMut(Atom) -> Atom| match key {
        PropKey::Name(name) | PropKey::Private(name) => replace_in(name, f),
        PropKey::None | PropKey::Computed(_) => {}
    };
    // The texts of templates are in `ids`.
    let mut texts: Vec<(u32, u32)> = Vec::new();
    for it in file.references.iter_mut() {
        replace_in(&mut it.1, f);
    }
    for it in file.specifier_uses.iter_mut() {
        replace_in(&mut it.spec, f);
    }
    let JsxPragmas {
        classic: _,
        factory,
        fragment_factory,
        import_source,
    } = &mut *file.jsx_pragmas;
    replace_in(factory, f);
    replace_in(fragment_factory, f);
    replace_in(import_source, f);
    for it in file.exprs.iter_mut() {
        match &mut it.kind {
            ExprKind::Ident(name)
            | ExprKind::PrivateIdentifier(name)
            | ExprKind::String(name)
            | ExprKind::BigInt(name)
            | ExprKind::NewTarget(name)
            | ExprKind::Dot { name, .. } => replace_in(name, f),
            // `File::template_texts`
            ExprKind::Template { exprs } => texts.push((exprs.start + exprs.len, exprs.len + 1)),
            // Without substitutions its `Call::template` is a string, and the list has the text
            // all the same.
            ExprKind::TaggedTemplate(call) => {
                let exprs = file.calls[call.idx()].args;
                texts.push((exprs.start + exprs.len, exprs.len + 1));
            }
            _ => {}
        }
    }
    for it in file.stmts.iter_mut() {
        match &mut it.kind {
            StmtKind::Break(name)
            | StmtKind::Continue(name)
            | StmtKind::ExportAsNamespace(name)
            | StmtKind::Labeled { label: name, .. } => replace_in(name, f),
            StmtKind::ExportStar { spec, alias, .. } => {
                replace_in(spec, f);
                replace_in(alias, f);
            }
            _ => {}
        }
    }
    for it in file.types.iter_mut() {
        match &mut it.kind {
            TypeNodeKind::StringLit(name)
            | TypeNodeKind::BigIntLit { text: name, .. }
            | TypeNodeKind::Import { spec: name, .. }
            | TypeNodeKind::Predicate { param: name, .. } => replace_in(name, f),
            TypeNodeKind::Template { texts: list, .. } => texts.push((list.start, list.len)),
            _ => {}
        }
    }
    for it in file.pats.iter_mut() {
        if let PatKind::Ident(name) = &mut it.kind {
            replace_in(name, f);
        }
    }
    for it in file.pat_props.iter_mut() {
        key(&mut it.key, f);
    }
    for it in file.members.iter_mut() {
        key(&mut it.key, f);
    }
    for it in file.props.iter_mut() {
        key(&mut it.key, f);
    }
    for it in file.fns.iter_mut() {
        replace_in(&mut it.name, f);
    }
    for it in file.type_params.iter_mut() {
        replace_in(&mut it.name, f);
    }
    for it in file.classes.iter_mut() {
        replace_in(&mut it.name, f);
    }
    for it in file.interfaces.iter_mut() {
        replace_in(&mut it.name, f);
    }
    for it in file.aliases.iter_mut() {
        replace_in(&mut it.name, f);
    }
    for it in file.enums.iter_mut() {
        replace_in(&mut it.name, f);
    }
    for it in file.enum_members.iter_mut() {
        replace_in(&mut it.name, f);
    }
    for it in file.modules.iter_mut() {
        match &mut it.name {
            ModuleName::Ident(name) | ModuleName::String(name) => replace_in(name, f),
            ModuleName::Global => {}
        }
    }
    for it in file.imports.iter_mut() {
        replace_in(&mut it.spec, f);
        replace_in(&mut it.default, f);
        replace_in(&mut it.namespace, f);
    }
    for it in file.import_specs.iter_mut() {
        replace_in(&mut it.imported, f);
        replace_in(&mut it.local, f);
    }
    for it in file.import_equals.iter_mut() {
        replace_in(&mut it.name, f);
        match &mut it.target {
            ImportEqualsTarget::Require(spec) => replace_in(spec, f),
            ImportEqualsTarget::Entity(_) => {}
        }
    }
    for it in file.exports.iter_mut() {
        replace_in(&mut it.spec, f);
    }
    for it in file.export_specs.iter_mut() {
        replace_in(&mut it.local, f);
        replace_in(&mut it.exported, f);
    }
    for it in file.tuple_elems.iter_mut() {
        replace_in(&mut it.name, f);
    }
    for it in file.names.iter_mut() {
        replace_in(&mut it.text, f);
    }
    for (start, len) in without_duplicates(texts) {
        for id in &mut file.ids[start as usize..(start + len) as usize] {
            let mut atom = Atom(*id);
            replace_in(&mut atom, f);
            *id = atom.0;
        }
    }
}

/// The name of a field in which the two files or their side tables differ.
#[cfg(any(debug_assertions, feature = "baselines"))]
pub fn first_difference(a: (&File, &Bound), b: (&File, &Bound)) -> Option<&'static str> {
    macro_rules! same {
        ($a:expr, $b:expr, $name:expr) => {
            if format!("{:?}", $a) != format!("{:?}", $b) {
                return Some($name);
            }
        };
    }
    macro_rules! files {
        (plain: [$($p:ident)*] lists: [$($l:ident)*] few: [$($f:ident)*] kept: [$($k:ident)*]) => {
            $(same!(a.0.$p, b.0.$p, stringify!($p));)*
            $(same!(&a.0.$l[..], &b.0.$l[..], stringify!($l));)*
            $(same!(&a.0.$f[..], &b.0.$f[..], stringify!($f));)*
            $(same!(&a.0.$k[..], &b.0.$k[..], stringify!($k));)*
        };
    }
    file_fields!(files);
    macro_rules! bounds {
        (plain: [$($p:ident)*] lists: [$($l:ident)*] few: [$($f:ident)*] maps: [$($m:ident)*]) => {
            $(same!(a.1.$p, b.1.$p, stringify!($p));)*
            $(same!(&a.1.$l[..], &b.1.$l[..], stringify!($l));)*
            $(same!(&a.1.$f[..], &b.1.$f[..], stringify!($f));)*
            $(if a.1.$m != b.1.$m {
                return Some(stringify!($m));
            })*
        };
    }
    bound_fields!(bounds);
    if a.1.large_tables != b.1.large_tables {
        return Some("large_tables");
    }
    if a.1.this_in_type_literal != b.1.this_in_type_literal {
        return Some("this_in_type_literal");
    }
    same!(&a.1.nested_names[..], &b.1.nested_names[..], "nested_names");
    let symbol = |it: &crate::bind::Symbol| {
        let decls = format!("{:?}", it.decls.as_slice());
        let tables = (it.parent, it.exports, it.members, it.export_symbol);
        format!(
            "{:?}",
            (it.name, it.flags, decls, it.value_declaration, tables)
        )
    };
    if !a
        .1
        .symbols
        .iter()
        .map(symbol)
        .eq(b.1.symbols.iter().map(symbol))
    {
        return Some("symbols");
    }
    None
}
