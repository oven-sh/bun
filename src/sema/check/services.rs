//! `ts.TypeChecker` as those outside the checker use it: what is the type at this node, what does
//! this name refer to, what are the properties of this type.
//!
//! A [`Services`] is entered for a file right after that file has been checked
//! ([`Checker::with_services`]), and answers until it is dropped. Nothing that it hands out may be
//! kept longer: the ids of types, signatures and names belong to the task that checks the file.
//!
//! - A node is a [`NodeRef`]: a file of the program and a [`Node`] of it.
//! - A type is a `TypeId`, a signature a `SigId`.
//! - A symbol is a [`SymbolRef`]. The checker has no one thing that is a `ts.Symbol`: what the
//!   binder declares in a table is a `Sym`, a property of a type is a `Prop` and the mapper to read
//!   it with, a parameter of a signature is a `SigParam`. This numbers them as they come up, so
//!   that equal numbers are what TypeScript has one object for.

mod jsdoc;
pub(in crate::check) mod symbol_at_location;
mod symbols;
mod type_at_location;
mod types;
pub(in crate::check) mod visited;
mod vocabulary;

pub use vocabulary::ObjectFlags;
pub use vocabulary::*;

use super::*;
use crate::bind::{Decl, ScopeId, SymbolId};
use crate::node::{Kind, Node, NodeData};
use smallvec::SmallVec;
use std::cell::OnceCell;
use symbols::{Entry, Key};
use visited::VisitedKind;

/// Calls what it is given with the text of the file of the default library that has that name, if it
/// can be read. The checker does not keep that text.
pub type ReadLibrary<'r> = &'r (dyn Fn(&[u8], &mut dyn FnMut(&[u8])) + Sync);

pub struct Services<'c, 'p, 's> {
    c: &'c mut Checker<'p, 's>,
    file: FileId,
    /// For the lists that are made up for an answer.
    arena: &'c Arena,
    symbols: Vec<Entry<'c>>,
    symbol_ids: FxHashMap<Key<'c>, SymbolRef>,
    /// What `properties_of_type` and `signature_info` have answered.
    properties: FxHashMap<TypeId, &'c [SymbolRef]>,
    signatures: FxHashMap<SigId, SignatureInfo<'c>>,
    /// `Checker::symbols_of_declarations` of `file`.
    symbols_of_declarations: OnceCell<FxHashMap<Decl, SymbolId>>,
    read_library: Option<ReadLibrary<'c>>,
    /// What the queries must not change for the files that the task checks next.
    flow_analysis_was_disabled: bool,
    had_run_out_of_stack: bool,
}

impl<'p, 's> Checker<'p, 's> {
    /// Calls `then` with the services for `file`, which has just been checked.
    ///
    /// `read_library`: without it nothing in the default library counts as deprecated.
    pub fn with_services<R>(
        &mut self,
        file: FileId,
        read_library: Option<ReadLibrary<'_>>,
        then: impl FnOnce(&mut Services<'_, 'p, 's>) -> R,
    ) -> R {
        let arena = Arena::new();
        let mut services = Services {
            flow_analysis_was_disabled: self.flow_analysis_disabled,
            had_run_out_of_stack: self.ran_out_of_stack.get(),
            c: self,
            file,
            arena: &arena,
            read_library,
            symbols: Vec::new(),
            symbol_ids: FxHashMap::default(),
            properties: FxHashMap::default(),
            signatures: FxHashMap::default(),
            symbols_of_declarations: OnceCell::new(),
        };
        then(&mut services)
    }
}

impl Drop for Services<'_, '_, '_> {
    fn drop(&mut self) {
        self.c.flow_analysis_disabled = self.flow_analysis_was_disabled;
        self.c.ran_out_of_stack.set(self.had_run_out_of_stack);
        self.c.rechecked_exprs.clear();
        self.c.rechecked_members.clear();
    }
}

impl<'c, 'p, 's> Services<'c, 'p, 's> {
    /// The checker, for what is not here.
    #[inline]
    pub fn checker(&mut self) -> &mut Checker<'p, 's> {
        self.c
    }

    #[inline]
    fn list<T: Copy>(&self, items: &[T]) -> &'c [T] {
        match items.is_empty() {
            true => &[],
            false => self.arena.alloc_slice_copy(items),
        }
    }

    /// Whether `file` is one whose tree can be read.
    #[inline]
    fn has_file(&self, file: FileId) -> bool {
        (file.0 as usize) < self.c.files().modules.len()
    }

    /// `node`, if it is a node of a file of the program.
    #[inline]
    fn valid(&self, node: NodeRef) -> Option<(&'p hir::File<'s>, Node)> {
        (node.node.is_some() && self.has_file(node.file)).then(|| (self.c.hir(node.file), node.node))
    }

    /// The expression that `node` is, or is the parentheses around.
    fn expr_of(&self, node: NodeRef) -> Option<ExprId> {
        let (hir, at) = self.valid(node)?;
        match hir.data(at) {
            NodeData::Expr(e) => Some(e),
            NodeData::Paren(p) => hir.parens.get(p.idx()).map(|it| it.0),
            // A function or a class that is an expression has the handle of its own.
            _ => match hir.kind(at) {
                Kind::FunctionExpression | Kind::ArrowFunction => {
                    match self.c.bound(node.file).fns.get(hir.function_of(at).idx())?.owner {
                        crate::bind::FnOwner::Expr(e) => Some(e),
                        _ => None,
                    }
                }
                Kind::ClassExpression => {
                    match *self.c.bound(node.file).class_owner.get(hir.class_of(at).idx())? {
                        crate::bind::ClassOwner::Expr(e) => Some(e),
                        crate::bind::ClassOwner::Stmt(_) => None,
                    }
                }
                _ => None,
            },
        }
    }

    // ───────────────────────────── the program ─────────────────────────────

    pub fn compiler_options(&mut self) -> CompilerOptions {
        let options = self.c.files().compiler_options_for_file(self.file);
        CompilerOptions {
            strict_null_checks: options.strict_null_checks,
            strict_function_types: options.strict_function_types,
            strict_bind_call_apply: options.strict_bind_call_apply,
            strict_property_initialization: options.strict_property_initialization,
            strict_builtin_iterator_return: options.strict_builtin_iterator_return,
            no_implicit_any: options.no_implicit_any,
            no_implicit_this: options.no_implicit_this,
            no_implicit_returns: options.no_implicit_returns,
            no_implicit_override: options.no_implicit_override,
            use_unknown_in_catch_variables: options.use_unknown_in_catch_variables,
            no_unchecked_indexed_access: options.no_unchecked_indexed_access,
            no_property_access_from_index_signature: options.no_property_access_from_index_signature,
            no_fallthrough_cases_in_switch: options.no_fallthrough_cases_in_switch,
            exact_optional_property_types: options.exact_optional_property_types,
            isolated_modules: options.isolated_modules,
            isolated_declarations: options.isolated_declarations,
            verbatim_module_syntax: options.verbatim_module_syntax,
            erasable_syntax_only: options.erasable_syntax_only,
            experimental_decorators: options.experimental_decorators,
            emit_decorator_metadata: options.emit_decorator_metadata,
            // TypeScript 7 has neither as an option: both are always on.
            allow_synthetic_default_imports: true,
            es_module_interop: true,
            use_define_for_class_fields: options.use_define_for_class_fields,
            allow_js: options.allow_js,
            check_js: options.check_js == Some(true),
            resolve_json_module: options.resolve_json_module,
            preserve_const_enums: options.preserve_const_enums,
            use_case_sensitive_file_names: options.use_case_sensitive_file_names,
            target: options.target,
            module: options.module,
        }
    }

    pub fn current_directory(&mut self) -> &'p [u8] {
        &self.c.files().options.current_directory
    }

    #[inline]
    pub fn current_file(&mut self) -> FileId {
        self.file
    }

    pub fn file_info(&mut self, file: FileId) -> FileInfo<'p> {
        if !self.has_file(file) {
            return FileInfo {
                file_name: b"",
                is_default_library: false,
                is_from_external_library: false,
                is_declaration_file: false,
                is_javascript: false,
                is_external_module: false,
                package_name: None,
            };
        }
        let module = self.c.files().module(file);
        FileInfo {
            file_name: module.file_name(),
            is_default_library: module.is_lib,
            is_from_external_library: module.is_from_external_library,
            is_declaration_file: module.hir.kind == FileKind::Declaration,
            is_javascript: module.hir.is_js,
            is_external_module: module.is_module(),
            package_name: match path_in_node_modules(module.file_name()) {
                Some(path) => Some(path),
                None if module.is_from_external_library => self.package_names_of_linked_files().get(&file).map(Vec::as_slice),
                None => None,
            },
        }
    }

    /// `sourceFileToPackageName` of the files that a link in a `node_modules` leads to, as in a
    /// workspace. Their paths do not tell: what tells is that something imports them as a package.
    fn package_names_of_linked_files(&self) -> &'p FxHashMap<FileId, Vec<u8>> {
        let program = self.c.p;
        program.package_names_of_linked_files.get_or_init(|| {
            let (files, mut names) = (program.files, FxHashMap::<FileId, Vec<u8>>::default());
            for importer in files.modules.iter() {
                for (&(specifier, _), &file) in importer.imports.iter() {
                    let module = files.module(file);
                    if !module.is_from_external_library || module.package_json_directory.is_none() {
                        continue;
                    }
                    let directory = files.atoms.bytes(module.package_json_directory);
                    let in_package = module.file_name().strip_prefix(directory).and_then(|it| it.strip_prefix(b"/"));
                    let (Some(package), Some(in_package)) = (package_of_specifier(files.atoms.bytes(specifier)), in_package) else {
                        continue;
                    };
                    if path_in_node_modules(module.file_name()).is_some() {
                        continue;
                    }
                    let name = cat!(package, b"/", in_package);
                    // Whatever the order of the imports.
                    match names.entry(file) {
                        std::collections::hash_map::Entry::Occupied(mut known) if name < *known.get() => {
                            known.insert(name);
                        }
                        std::collections::hash_map::Entry::Occupied(_) => {}
                        std::collections::hash_map::Entry::Vacant(place) => {
                            place.insert(name);
                        }
                    }
                }
            }
            names
        })
    }

    pub fn source_file(&mut self, file_name: &[u8]) -> Option<FileId> {
        self.c.files().by_path.get(file_name)
    }

    /// `checker.getAmbientModules().find(it => it.name === '"name"')`
    pub fn ambient_module(&mut self, name: &[u8]) -> Option<SymbolRef> {
        let name = self.c.atoms().lookup(name)?;
        let module = self.c.files().try_find_ambient_module(name)?;
        Some(self.symbol(module))
    }

    pub fn resolve_module_name(&mut self, specifier: &[u8]) -> Option<FileId> {
        let specifier = self.c.atoms().lookup(specifier)?;
        let imports = &self.c.files().module(self.file).imports;
        let mut found = imports.iter().filter(|it| it.0.0 == specifier);
        found.next().map(|it| *it.1)
    }

    // ───────────────────────────── nodes ─────────────────────────────

    /// The node of the file at hand that `location` names. `NONE` if there is none.
    pub fn node(&mut self, location: Location) -> Node {
        let hir = self.c.hir(self.file);
        let row = match location.row {
            Row::File => Node::FILE,
            Row::Node(node) => node,
            Row::Expr(id) => hir.node(id),
            Row::Parenthesized(id) => hir.child(id),
            Row::Stmt(id) => hir.node(id),
            Row::Type(id) => hir.node(id),
            Row::Pat(id) => hir.node(id),
            Row::PatProp(id) => hir.node(id),
            Row::PatElem(id) => hir.node(id),
            Row::Fn(id) => hir.node(id),
            Row::Class(id) => hir.node(id),
            Row::Param(id) => hir.node(id),
            Row::TypeParam(id) => hir.node(id),
            Row::Member(id) => hir.node(id),
            Row::Prop(id) => hir.node(id),
            Row::VarDecl(id) => hir.node(id),
            Row::Case(id) => hir.node(id),
            Row::EnumMember(id) => hir.node(id),
            Row::ImportSpec(id) => hir.node(id),
            Row::ExportSpec(id) => hir.node(id),
            Row::TupleElem(id) => hir.node(id),
            Row::Name(id) => hir.node(id),
            Row::NameAt(offset) => self.name_at(offset),
        };
        match location.part {
            // `node.name`, which for a variable, a parameter or a binding element is a pattern.
            Some(crate::node::Part::Name) if row.is_some() => hir.name(row),
            Some(part) => row.with(part),
            None => row,
        }
    }

    /// The innermost node that starts at `offset` and has no children: a name or a literal.
    fn name_at(&self, offset: u32) -> Node {
        let hir = self.c.hir(self.file);
        let mut work: SmallVec<[Node; 16]> = SmallVec::new();
        work.push(Node::FILE);
        while let Some(at) = work.pop() {
            let before = work.len();
            hir.for_each_child(at, &mut |child| {
                // Where a node begins and ends that is derived from another is not always known.
                let is_around = child.part().is_some()
                    || hir.start(child) <= offset && offset < self.c.end_of_node(self.file, child);
                if is_around {
                    work.push(child);
                }
                false
            });
            if work.len() == before && at != Node::FILE && hir.start(at) == offset {
                return at;
            }
        }
        Node::NONE
    }

    pub fn node_kind(&mut self, node: NodeRef) -> Kind {
        self.valid(node).map_or(Kind::Unknown, |(hir, node)| hir.kind(node))
    }

    pub fn node_data(&mut self, node: NodeRef) -> NodeData {
        self.valid(node).map_or(NodeData::None, |(hir, node)| hir.data(node))
    }

    pub fn node_parent(&mut self, node: NodeRef) -> Node {
        match self.valid(node) {
            Some((hir, node)) if node != Node::FILE => hir.parent(node),
            _ => Node::NONE,
        }
    }

    pub fn node_child(&mut self, node: NodeRef, child: Child) -> Node {
        let Some((hir, node)) = self.valid(node) else {
            return Node::NONE;
        };
        match child {
            Child::Name => hir.name(node),
            Child::PropertyName => hir.property_name(node),
            Child::Expression => hir.expression(node),
            Child::Initializer => hir.initializer(node),
            Child::Type => hir.type_node(node),
            Child::Body => hir.body(node),
            Child::Constraint | Child::Default => match hir.data(node) {
                NodeData::TypeParam(parameter) if child == Child::Constraint => hir.node(hir[parameter].constraint),
                NodeData::TypeParam(parameter) => hir.node(hir[parameter].default),
                _ => Node::NONE,
            },
        }
    }

    pub fn node_children(&mut self, node: NodeRef) -> &'c [Node] {
        let Some((hir, node)) = self.valid(node) else {
            return &[];
        };
        let mut children: SmallVec<[Node; 8]> = SmallVec::new();
        hir.for_each_child(node, &mut |child| {
            children.push(child);
            false
        });
        self.list(&children)
    }

    pub fn node_span(&mut self, node: NodeRef) -> (u32, u32) {
        match self.valid(node) {
            // The text of the default library is not kept, and the end of a node is found in it.
            Some((hir, at)) if !hir.text.is_empty() => {
                let (start, end) = (hir.start(at), self.c.end_of_node(node.file, at));
                // The HIR does not say where every node is that is derived from another.
                match at.part().is_some() && (end <= start || start == 0 && hir.start(at.row()) != 0) {
                    true => (0, 0),
                    false => (start, end),
                }
            }
            _ => (0, 0),
        }
    }

    pub fn node_text(&mut self, node: NodeRef) -> &'p [u8] {
        let Some((hir, node)) = self.valid(node) else {
            return b"";
        };
        match hir.text(node) {
            Atom::NONE => b"",
            text => self.c.atoms().bytes(text),
        }
    }

    /// The text of the file from the first token of `node` to the end of its last.
    pub fn node_source_text(&mut self, node: NodeRef) -> &'p [u8] {
        let (start, end) = self.node_span(node);
        match self.valid(node) {
            Some((hir, _)) => hir.text.get(start as usize..end as usize).unwrap_or_default(),
            None => b"",
        }
    }

    /// `isTypeOnlyImportOrExportDeclaration` if `with_parents`, else `node.isTypeOnly`.
    pub fn is_type_only(&mut self, node: NodeRef, with_parents: bool) -> bool {
        let Some((hir, at)) = self.valid(node) else {
            return false;
        };
        match (hir.data(at), hir.data(at.row())) {
            (NodeData::ImportSpec(s), _) => hir[s].type_only || with_parents && hir[hir[s].import].type_only,
            (NodeData::ExportSpec(s), _) => hir[s].type_only || with_parents && hir[hir[s].export].type_only,
            (data, NodeData::Stmt(s)) => match (hir[s].kind, data) {
                (StmtKind::Import(i), NodeData::Part(crate::node::Part::ImportClause, _)) => hir[i].type_only,
                (StmtKind::Import(i), NodeData::Part(crate::node::Part::NamedBindings, _)) => {
                    with_parents && hir.kind(at) == Kind::NamespaceImport && hir[i].type_only
                }
                (StmtKind::ImportEquals(i), NodeData::Stmt(_)) => hir[i].flags.contains(Flags::TYPE_ONLY),
                (StmtKind::ExportNamed(e), NodeData::Stmt(_)) => !with_parents && hir[e].type_only,
                // `export type * from "m"` is one, `export type * as ns from "m"` has a clause that is.
                (StmtKind::ExportStar { type_only, .. }, NodeData::Stmt(_)) => {
                    type_only && (!with_parents || hir.kind(at.with(crate::node::Part::ExportClause)) != Kind::NamespaceExport)
                }
                (StmtKind::ExportStar { type_only, .. }, NodeData::Part(crate::node::Part::ExportClause, _)) => {
                    with_parents && type_only
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// What the HIR stores for `node` besides its modifiers: `?`, `...`, `!`, `*`.
    pub fn node_hir_flags(&mut self, node: NodeRef) -> Flags {
        self.valid(node).map_or(Flags::empty(), |(hir, node)| hir.flags(node))
    }

    /// `getCombinedModifierFlags`
    pub fn node_modifier_flags(&mut self, node: NodeRef) -> ModifierFlags {
        let Some((hir, mut at)) = self.valid(node) else {
            return ModifierFlags::empty();
        };
        // `getCombinedFlags`: of a binding element, those of the declaration it is part of, and of
        // a variable declaration also those of its list and its statement.
        let mut depth = 0;
        while hir.kind(at) == Kind::BindingElement && depth < 4096 {
            at = hir.parent(hir.parent(at));
            depth += 1;
        }
        let mut flags = hir.flags(at);
        // Only the modifier `declare` is `ModifierFlags.Ambient`. That of a variable is on its
        // statement.
        if flags.contains(Flags::AMBIENT) {
            let modified = match hir.kind(at) {
                Kind::VariableDeclaration => hir.parent(hir.parent(at)),
                _ => at,
            };
            let mut has_declare_modifier = false;
            hir.for_each_child(modified, &mut |child| {
                has_declare_modifier = hir.kind(child) == Kind::DeclareKeyword;
                has_declare_modifier
            });
            if !has_declare_modifier {
                flags.remove(Flags::AMBIENT);
            }
        }
        ModifierFlags::from(flags)
    }

    /// `getCombinedNodeFlags`
    pub fn node_flags(&mut self, node: NodeRef) -> NodeFlags {
        let Some((hir, mut at)) = self.valid(node) else {
            return NodeFlags::empty();
        };
        let mut flags = NodeFlags::empty();
        if hir.is_ambient(at) {
            flags |= NodeFlags::AMBIENT;
        }
        if hir.is_in_with(hir.start(at)) {
            flags |= NodeFlags::IN_WITH_STATEMENT;
        }
        let mut depth = 0;
        while hir.kind(at) == Kind::BindingElement && depth < 4096 {
            at = hir.parent(hir.parent(at));
            depth += 1;
        }
        match hir.data(at.row()) {
            NodeData::VarDecl(declaration) => flags |= flags_of_var_kind(hir[declaration].kind),
            NodeData::Stmt(statement) => match hir[statement].kind {
                StmtKind::Var(declarations) => {
                    if let Some(first) = declarations.iter().next() {
                        flags |= flags_of_var_kind(hir[first].kind);
                    }
                }
                StmtKind::Module(module) => match hir[module].name {
                    ModuleName::Global => flags |= NodeFlags::GLOBAL_AUGMENTATION,
                    ModuleName::Ident(_) if self.is_written_as_namespace(node.file, at) => {
                        flags |= NodeFlags::NAMESPACE;
                    }
                    _ => {}
                },
                _ => {}
            },
            NodeData::Expr(e) => {
                let chain = match hir[e].kind {
                    ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain,
                    ExprKind::Call(call) => hir[call].chain,
                    _ => Chain::No,
                };
                if chain != Chain::No {
                    flags |= NodeFlags::OPTIONAL_CHAIN;
                }
            }
            _ => {}
        }
        flags
    }

    /// The keyword of the `ModuleDeclaration` is `namespace`. An inner part of `namespace a.b` has
    /// none of its own.
    fn is_written_as_namespace(&self, file: FileId, node: Node) -> bool {
        let hir = self.c.hir(file);
        let mut text = hir.text.get(hir.start(node) as usize..).unwrap_or_default();
        for modifier in [&b"export"[..], b"declare"] {
            text = text.strip_prefix(modifier).map_or(text, |rest| rest.trim_ascii_start());
        }
        !text.starts_with(b"module")
    }

    // ───────────────────────────── from a node ─────────────────────────────

    /// `node.Symbol` of a declaration for which the binder has no table. `NONE`: it has none.
    fn symbol_of_rejected_declaration(&self, file: FileId, decl: Decl) -> SymbolId {
        let found = match file == self.file {
            true => {
                let symbols = (self.symbols_of_declarations).get_or_init(|| self.c.symbols_of_declarations(file));
                symbols.get(&decl).copied()
            }
            false => self.c.symbols_of_declarations(file).get(&decl).copied(),
        };
        found.unwrap_or(SymbolId::NONE)
    }

    /// What `node` is, if it is an expression, an identifier or the name of a declaration.
    fn visited_kind(&self, node: NodeRef) -> Option<VisitedKind> {
        self.c.visited_kind(node.file, node.node, &|decl| self.symbol_of_rejected_declaration(node.file, decl).some())
    }

    pub fn type_from_type_node(&mut self, node: NodeRef) -> TypeId {
        match self.valid(node).map(|(hir, at)| hir.data(at)) {
            Some(NodeData::Type(ty)) => self.c.type_from_node(node.file, ty),
            _ => TypeId::ERROR,
        }
    }

    pub fn contextual_type(&mut self, node: NodeRef) -> Option<TypeId> {
        if let Some((hir, at)) = self.valid(node) {
            // The name in the tag of a JSX element: `getContextualJsxElementAttributesType`.
            let tag = hir.parent(at);
            if matches!(hir.kind(tag), Kind::JsxOpeningElement | Kind::JsxSelfClosingElement)
                && hir.is_jsx_tag_name(at)
                && let NodeData::Expr(element) = hir.data(tag.row())
            {
                let outer = self.c.begin_recheck();
                let ty = self.c.contextual_jsx_element_attributes_type(node.file, element);
                self.c.end_recheck(outer);
                return ty;
            }
            // The name of a property of an object literal: `getContextualTypeForObjectLiteralElement`,
            // which is what its value gets.
            if at.part() == Some(crate::node::Part::Name)
                && let NodeData::Prop(p) = hir.data(at.row())
                && matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand)
                && hir.kind(at.row()) != Kind::JsxAttribute
            {
                return self.contextual_type(NodeRef {
                    node: hir.node(hir[p].value),
                    ..node
                });
            }
        }
        // A `JsxExpression` that is the value of an attribute has the contextual type of what is
        // in it. One that is a child has none.
        let node = match self.valid(node) {
            Some((hir, at)) if at.part() == Some(crate::node::Part::JsxExpression) => {
                if hir.kind(hir.parent(at)) != Kind::JsxAttribute {
                    return None;
                }
                NodeRef {
                    node: at.row(),
                    ..node
                }
            }
            _ => node,
        };
        let e = self.expr_of(node)?;
        let outer = self.c.begin_recheck();
        let ty = self.c.contextual_type(node.file, e, ContextFlags::empty());
        self.c.end_recheck(outer);
        ty
    }

    pub fn apparent_type_of_contextual_type(&mut self, node: NodeRef) -> Option<TypeId> {
        let e = self.expr_of(node)?;
        let outer = self.c.begin_recheck();
        let ty = self.c.apparent_type_of_contextual_type(node.file, e, ContextFlags::empty());
        self.c.end_recheck(outer);
        ty
    }

    pub fn contextual_type_for_argument_at_index(&mut self, call: NodeRef, index: u32) -> Option<TypeId> {
        let e = self.expr_of(call)?;
        let hir = self.c.hir(call.file);
        let (ExprKind::Call(id) | ExprKind::New(id)) = hir[e].kind else {
            return None;
        };
        let argument = hir.ids(hir[id].args).nth(index as usize)?;
        let outer = self.c.begin_recheck();
        let ty = self.c.contextual_type_for_argument(call.file, e, argument);
        self.c.end_recheck(outer);
        ty
    }

    pub fn resolved_signature(&mut self, call: NodeRef) -> Option<SigId> {
        let (hir, at) = self.valid(call)?;
        // The opening element of a JSX element is resolved as the element.
        let at = match at.part() {
            Some(crate::node::Part::Opening) => at.row(),
            _ => at,
        };
        let e = self.expr_of(NodeRef { node: at, ..call })?;
        let is_call_like = matches!(
            hir[e].kind,
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) | ExprKind::Jsx(_)
        ) || matches!(hir[e].kind, ExprKind::Binary { op: BinOp::Instanceof, .. })
            || matches!(self.c.bound(call.file).expr_parent.get(e.idx()), Some(crate::bind::Parent::Decorator(..)));
        if !is_call_like {
            return None;
        }
        self.c.resolved_signature(call.file, e).sig
    }

    pub fn signature_from_declaration(&mut self, node: NodeRef) -> Option<SigId> {
        let (hir, at) = self.valid(node)?;
        if !hir.kind(at).is_function_like() {
            return None;
        }
        let function = hir.function_of(at).some()?;
        Some(self.c.sig_of_fn(node.file, function))
    }

    pub fn accessed_property_name(&mut self, node: NodeRef) -> Option<&'p [u8]> {
        let (hir, at) = self.valid(node)?;
        let name = match hir.data(at) {
            NodeData::Expr(e) => match hir[e].kind {
                ExprKind::Dot { name, .. } => name,
                ExprKind::Index { index, .. } => match hir[index].kind {
                    ExprKind::String(text) => text,
                    ExprKind::Number(number) => self.c.number_name(*hir.numbers.get(number as usize)?),
                    _ => {
                        let ty = self.c.type_of_expr(node.file, index);
                        self.c.property_name_of_type(ty)?
                    }
                },
                _ => return None,
            },
            NodeData::PatProp(p) => match hir[p].key {
                PropKey::Name(name) => name,
                PropKey::Computed(e) => {
                    let ty = self.c.type_of_expr(node.file, e);
                    self.c.property_name_of_type(ty)?
                }
                _ => return None,
            },
            // The index of the element in its pattern, of the parameter in its list.
            NodeData::PatElem(element) => {
                let pattern = hir.parent(at);
                let mut index = 0;
                let mut found = None;
                hir.for_each_child(pattern, &mut |child| {
                    if child == hir.node(element) {
                        found = Some(index);
                    }
                    index += 1;
                    found.is_some()
                });
                self.c.number_name(f64::from(found?))
            }
            NodeData::Param(parameter) => {
                let function = *self.c.bound(node.file).param_fn.get(parameter.idx())?;
                self.c.number_name(f64::from(parameter.0.checked_sub(hir[function].params.start)?))
            }
            _ => return None,
        };
        Some(self.c.atoms().bytes(name))
    }

    pub fn constant_value(&mut self, node: NodeRef) -> Option<LiteralValue<'p>> {
        let (hir, at) = self.valid(node)?;
        let value = match hir.data(at) {
            NodeData::EnumMember(member) => self.c.enum_member_value(node.file, member)?,
            // `getConstantValue`: an access to a member of an enum.
            NodeData::Expr(e) if matches!(hir[e].kind, ExprKind::Dot { .. } | ExprKind::Index { .. }) => {
                let ty = self.c.type_of_expr(node.file, e);
                match *self.c.data(ty) {
                    TypeData::EnumLit { value, .. } => value,
                    _ => return None,
                }
            }
            _ => return None,
        };
        Some(match value {
            EnumValue::String(text) => LiteralValue::String(self.c.atoms().bytes(text)),
            EnumValue::Number(bits) => LiteralValue::Number(f64::from_bits(bits)),
        })
    }

    pub fn is_const_context(&mut self, node: NodeRef) -> bool {
        self.expr_of(node).is_some_and(|e| self.c.is_const_context(node.file, e))
    }

    pub fn flow_type_of_reference(&mut self, node: NodeRef, declared: TypeId) -> TypeId {
        match self.expr_of(node) {
            Some(e) => self.c.flow_type_of_reference(node.file, e, declared),
            None => declared,
        }
    }

    pub fn context_free_type_of_expression(&mut self, node: NodeRef) -> TypeId {
        match self.expr_of(node) {
            Some(e) => self.c.context_free_type_of_expression(node.file, e),
            None => TypeId::ERROR,
        }
    }

    pub fn type_with_default(&mut self, ty: TypeId, default: NodeRef) -> TypeId {
        match self.expr_of(default) {
            Some(e) => self.c.get_type_with_default(default.file, ty, e),
            None => ty,
        }
    }

    /// The scope that names at `node` are resolved from.
    fn scope_at(&self, node: NodeRef) -> Option<ScopeId> {
        let (hir, mut at) = self.valid(node)?;
        let bound = self.c.bound(node.file);
        let mut depth = 0;
        while at.is_some() && depth < 4096 {
            let scope = match hir.data(at.row()) {
                NodeData::File => return Some(ScopeId(0)),
                NodeData::Expr(e) => Some(self.c.enclosing_scope_of_expr(node.file, e)),
                NodeData::Pat(pat) => Some(self.c.enclosing_scope_of_pat(node.file, pat)),
                NodeData::Member(m) => Some(self.c.enclosing_scope_of_member(node.file, m)),
                NodeData::Prop(p) => Some(self.c.enclosing_scope_of_property(node.file, p)),
                NodeData::Type(t) => bound.type_scope.get(t.idx()).copied(),
                NodeData::Stmt(s) => bound.stmt_scope.get(s.idx()).copied(),
                _ => None,
            };
            if let Some(scope) = scope.filter(|scope| scope.is_some()) {
                return Some(scope);
            }
            at = hir.parent(at);
            depth += 1;
        }
        Some(ScopeId(0))
    }
}

fn flags_of_var_kind(kind: VarKind) -> NodeFlags {
    match kind {
        VarKind::Var => NodeFlags::empty(),
        VarKind::Let => NodeFlags::LET,
        VarKind::Const => NodeFlags::CONST,
        VarKind::Using => NodeFlags::USING,
        VarKind::AwaitUsing => NodeFlags::AWAIT_USING,
    }
}

/// `packageIdToPackageName`: the name of the package and the path in it, which is what follows the
/// last `node_modules`. `getPackageNameFromTypesPackageName` is not applied.
fn path_in_node_modules(path: &[u8]) -> Option<&[u8]> {
    const NODE_MODULES: &[u8] = b"/node_modules/";
    let at = bun_core::strings::last_index_of(path, NODE_MODULES)?;
    Some(&path[at + NODE_MODULES.len()..])
}

/// `a` of `a/b`, `@a/b` of `@a/b/c`. `None` for a path.
fn package_of_specifier(specifier: &[u8]) -> Option<&[u8]> {
    if matches!(specifier.first(), None | Some(b'.' | b'/' | b'#')) {
        return None;
    }
    let Some(first) = bun_core::strings::index_of_char_usize(specifier, b'/') else {
        return Some(specifier);
    };
    if specifier[0] != b'@' {
        return Some(&specifier[..first]);
    }
    match bun_core::strings::index_of_char_usize(&specifier[first + 1..], b'/') {
        Some(second) => Some(&specifier[..first + 1 + second]),
        None => Some(specifier),
    }
}
