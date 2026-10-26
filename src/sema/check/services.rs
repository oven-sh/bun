//! `ts.TypeChecker` for callers outside the checker: what's the type at this node, what does this
//! name refer to, what are this type's properties.
//!
//! A [`Services`] is created for a file right after that file is checked
//! ([`Checker::with_services`]) and answers queries until it's dropped. Don't keep anything it
//! returns any longer: type, signature and name ids belong to the task that checks the file.
//!
//! - A node is a [`NodeRef`]: a file of the program and a [`Node`] in it.
//! - A type is a `TypeId`, a signature a `SigId`.
//! - A symbol is a [`SymbolRef`]. The checker has no single counterpart of `ts.Symbol`: a symbol
//!   the binder declares in a table is a `Sym`, a property of a type is a `Prop` plus the mapper to
//!   read it with, and a signature's parameter is a `SigParam`. `Services` numbers them as they
//!   come up, so equal numbers mean the same `ts.Symbol` object in TypeScript.

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
use crate::bind::{Decl, Parent, ScopeId, SymbolId};
use crate::node::{Kind, Node, NodeData};
use smallvec::SmallVec;
use std::cell::OnceCell;
use symbols::{Entry, Key};
use visited::VisitedKind;

/// Passes the text of the default library file with the given name to the callback, if the file can be read. The
/// checker doesn't keep that text.
pub type ReadLibrary<'r> = &'r (dyn Fn(&[u8], &mut dyn FnMut(&[u8])) + Sync);

/// Above this many constituents, signatures or elements, a result that takes a pass over all of them is cached.
const MANY: usize = 16;

/// A child node in the current file that is a HIR node or wraps one.
#[derive(Copy, Clone)]
struct ChildSpan {
    start: u32,
    end: u32,
    /// Its index among the children.
    position: u32,
    node: Node,
}

/// The children of a node with many children, indexed for [`Services::name_at`].
#[derive(Copy, Clone)]
struct ManyChildren<'c> {
    /// The children that are HIR nodes or wrap one. Both their starts and their ends are non-decreasing.
    spans: &'c [ChildSpan],
    /// The other children, each with its index among the children.
    parts: &'c [(u32, Node)],
}

impl ManyChildren<'_> {
    /// Pushes the parts and the children that contain `offset`, in child order. Finds the children by binary search.
    fn push_containing(self, offset: u32, work: &mut SmallVec<[Node; 16]>) {
        let from = self.spans.partition_point(|it| it.end <= offset);
        let to = self.spans.partition_point(|it| it.start <= offset);
        let mut containing = self
            .spans
            .get(from..to)
            .unwrap_or_default()
            .iter()
            .peekable();
        for &(position, part) in self.parts {
            while let Some(it) = containing.next_if(|it| it.position < position) {
                work.push(it.node);
            }
            work.push(part);
        }
        work.extend(containing.map(|it| it.node));
    }
}

pub struct Services<'c, 'p, 's> {
    c: &'c mut Checker<'p, 's>,
    file: FileId,
    /// Holds the lists built for results.
    arena: &'c Arena,
    symbols: Vec<Entry<'c>>,
    symbol_ids: FxHashMap<Key<'c>, SymbolRef>,
    /// Cached results of `properties_of_type` and `signature_info`.
    properties: FxHashMap<TypeId, &'c [SymbolRef]>,
    signatures: FxHashMap<SigId, SignatureInfo<'c>>,
    /// Cached results of `type_at_location`. Many rules query the same node, and some query one node from each of its
    /// many children.
    types_at: FxHashMap<NodeRef, TypeId>,
    /// Cached results of `type_op` for unions and intersections with many constituents, which it
    /// iterates over.
    ops_on_many: FxHashMap<(TypeOp, TypeId), Option<TypeId>>,
    /// Cached results of `flags_of_constituents` for unions with many constituents.
    flags_of_many: FxHashMap<TypeId, TypeFlags>,
    /// Cached results of `signatures_of_type` for types with many signatures. A new list for every call of a heavily
    /// overloaded function would take memory proportional to calls times overloads.
    many_signatures: FxHashMap<(TypeId, SignatureKind), &'c [SigId]>,
    /// The contextual types of object and array literals with many properties or elements.
    expected_of_many: FxHashMap<(FileId, ExprId), TypeId>,
    /// Cached results of `node_children` for nodes with many children. A new list each time a class member requests the
    /// heritage clauses would take memory quadratic in the number of members.
    children: FxHashMap<NodeRef, &'c [Node]>,
    /// Cached results of `all_super_type_nodes`.
    super_type_nodes: FxHashMap<NodeRef, &'c [Node]>,
    /// The nodes of `file` with many children that `name_at` has visited. `None` if the children aren't sorted.
    many_children: FxHashMap<Node, Option<ManyChildren<'c>>>,
    /// `Checker::symbols_of_declarations` of `file`.
    symbols_of_declarations: OnceCell<FxHashMap<Decl, SymbolId>>,
    read_library: Option<ReadLibrary<'c>>,
    /// The checker's list, restored on drop so that queries don't change it for the files the task
    /// checks next.
    flow_analysis_was_disabled: Vec<FileId>,
}

impl<'p, 's> Checker<'p, 's> {
    /// Calls `then` with the services for `file`, which has just been checked.
    ///
    /// Without `read_library`, nothing in the default library counts as deprecated.
    pub fn with_services<R>(
        &mut self,
        file: FileId,
        read_library: Option<ReadLibrary<'_>>,
        then: impl FnOnce(&mut Services<'_, 'p, 's>) -> R,
    ) -> R {
        let arena = Arena::new();
        // `check_file` skips a file that reports no semantic errors, and rules don't query in source order.
        if self.task.file == Some(file)
            && self.bound(file).has_types_that_depend_on_order()
            && !self.reports_semantic_errors(file)
        {
            self.check_source_file_silently(file);
        }
        // A reference whose control flow walk is too deep disables the analysis (2563). From then on every reference
        // has the error type until the enclosing function or module block ends, which at the top level of a file is
        // never. Rule queries aren't inside any block, so they start with the analysis enabled. Results the check
        // stored while it was disabled stay.
        let flow_analysis_was_disabled = std::mem::take(&mut self.flow_analysis_disabled);
        let mut services = Services {
            flow_analysis_was_disabled,
            c: self,
            file,
            arena: &arena,
            read_library,
            symbols: Vec::new(),
            symbol_ids: FxHashMap::default(),
            properties: FxHashMap::default(),
            signatures: FxHashMap::default(),
            types_at: FxHashMap::default(),
            ops_on_many: FxHashMap::default(),
            flags_of_many: FxHashMap::default(),
            many_signatures: FxHashMap::default(),
            expected_of_many: FxHashMap::default(),
            children: FxHashMap::default(),
            super_type_nodes: FxHashMap::default(),
            many_children: FxHashMap::default(),
            symbols_of_declarations: OnceCell::new(),
        };
        then(&mut services)
    }
}

impl Drop for Services<'_, '_, '_> {
    fn drop(&mut self) {
        self.c.flow_analysis_disabled = std::mem::take(&mut self.flow_analysis_was_disabled);
        self.c.rechecked_exprs.clear();
        self.c.rechecked_members.clear();
    }
}

impl<'c, 'p, 's> Services<'c, 'p, 's> {
    /// True if control flow analysis was disabled when the check of the file finished, or a query
    /// has disabled it since. Some references in the file then have the error type.
    pub fn was_flow_analysis_ever_disabled(&self) -> bool {
        self.flow_analysis_was_disabled.contains(&self.file)
            || self.c.flow_analysis_disabled.contains(&self.file)
    }

    #[inline]
    fn list<T: Copy>(&self, items: &[T]) -> &'c [T] {
        match items.is_empty() {
            true => &[],
            false => self.arena.alloc_slice_copy(items),
        }
    }

    /// True if `file` is in the program, so its tree can be read.
    #[inline]
    fn has_file(&self, file: FileId) -> bool {
        (file.0 as usize) < self.c.files().modules.len()
    }

    /// Returns `node` with its file's HIR, if it's a node in a file of the program.
    #[inline]
    fn valid(&self, node: NodeRef) -> Option<(&'p hir::File<'s>, Node)> {
        (node.node.is_some() && self.has_file(node.file))
            .then(|| (self.c.hir(node.file), node.node))
    }

    /// The expression that `node` is, or that `node` parenthesizes.
    fn expr_of(&self, node: NodeRef) -> Option<ExprId> {
        let (hir, at) = self.valid(node)?;
        match hir.data(at) {
            NodeData::Expr(e) => Some(e),
            NodeData::Paren(p) => hir.parens.get(p.idx()).map(|it| it.0),
            // A function or class expression's node data is its function or class handle, not an
            // `ExprId`.
            _ => match hir.kind(at) {
                Kind::FunctionExpression | Kind::ArrowFunction => {
                    match self
                        .c
                        .bound(node.file)
                        .fns
                        .get(hir.function_of(at).idx())?
                        .owner
                    {
                        crate::bind::FnOwner::Expr(e) => Some(e),
                        _ => None,
                    }
                }
                Kind::ClassExpression => {
                    match *self
                        .c
                        .bound(node.file)
                        .class_owner
                        .get(hir.class_of(at).idx())?
                    {
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
            no_implicit_any: options.no_implicit_any,
            no_implicit_this: options.no_implicit_this,
            no_implicit_returns: options.no_implicit_returns,
            no_implicit_override: options.no_implicit_override,
            use_unknown_in_catch_variables: options.use_unknown_in_catch_variables,
            no_unchecked_indexed_access: options.no_unchecked_indexed_access,
            no_property_access_from_index_signature: options
                .no_property_access_from_index_signature,
            no_fallthrough_cases_in_switch: options.no_fallthrough_cases_in_switch,
            exact_optional_property_types: options.exact_optional_property_types,
            isolated_modules: options.isolated_modules,
            isolated_declarations: options.isolated_declarations,
            verbatim_module_syntax: options.verbatim_module_syntax,
            experimental_decorators: options.experimental_decorators,
            emit_decorator_metadata: options.emit_decorator_metadata,
            // TypeScript 7 dropped both options. They're always on.
            allow_synthetic_default_imports: true,
            es_module_interop: true,
            allow_js: options.allow_js,
            check_js: options.check_js == Some(true),
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
            package_name: match path_in_node_modules(module.file_name()) {
                Some(path) => Some(path),
                None if module.is_from_external_library => self
                    .package_names_of_linked_files()
                    .get(&file)
                    .map(Vec::as_slice),
                None => None,
            },
        }
    }

    /// `sourceFileToPackageName` for files reached through a symlink in `node_modules`, as in a
    /// workspace. Their real paths don't contain `node_modules`, so the name comes from an import
    /// that refers to them as a package.
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
                    let in_package = module
                        .file_name()
                        .strip_prefix(directory)
                        .and_then(|it| it.strip_prefix(b"/"));
                    let (Some(package), Some(in_package)) = (
                        package_of_specifier(files.atoms.bytes(specifier)),
                        in_package,
                    ) else {
                        continue;
                    };
                    if path_in_node_modules(module.file_name()).is_some() {
                        continue;
                    }
                    let name = cat!(package, b"/", in_package);
                    // Keep the smallest name, so the result doesn't depend on the order of the
                    // imports.
                    match names.entry(file) {
                        std::collections::hash_map::Entry::Occupied(mut known)
                            if name < *known.get() =>
                        {
                            known.insert(name);
                        }
                        std::collections::hash_map::Entry::Occupied(_) => {}
                        std::collections::hash_map::Entry::Vacant(vacant) => {
                            vacant.insert(name);
                        }
                    }
                }
            }
            names
        })
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

    /// The node in the current file that `location` refers to, or `NONE`.
    pub fn node(&mut self, location: Location) -> Node {
        let hir = self.c.hir(self.file);
        let row = match location.row {
            Row::File => Node::FILE,
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
            // `node.name`, which is a pattern for a variable, parameter or binding element.
            Some(crate::node::Part::Name) if row.is_some() => hir.name(row),
            Some(part) => row.with(part),
            None => row,
        }
    }

    /// The innermost node that starts at `offset` and has no children: a name or a literal.
    fn name_at(&mut self, offset: u32) -> Node {
        let hir = self.c.hir(self.file);
        let mut work: SmallVec<[Node; 16]> = SmallVec::new();
        work.push(Node::FILE);
        while let Some(at) = work.pop() {
            let before = work.len();
            let known = self.many_children.get(&at).copied();
            if let Some(Some(children)) = known {
                children.push_containing(offset, &mut work);
            } else {
                let mut count = 0;
                hir.for_each_child(at, &mut |child| {
                    count += 1;
                    // The span of a node derived from another node isn't always known.
                    let contains_offset = child.part().is_some()
                        || hir.start(child) <= offset
                            && offset < self.c.end_of_node(self.file, child);
                    if contains_offset {
                        work.push(child);
                    }
                    false
                });
                if count > 16 && known.is_none() {
                    let children = self.many_children_of(at);
                    self.many_children.insert(at, children);
                }
            }
            if work.len() == before && at != Node::FILE && hir.start(at) == offset {
                return at;
            }
        }
        Node::NONE
    }

    /// `None` if a binary search wouldn't find the same children as a linear scan.
    fn many_children_of(&self, at: Node) -> Option<ManyChildren<'c>> {
        let hir = self.c.hir(self.file);
        let (mut spans, mut parts) = (Vec::new(), SmallVec::<[(u32, Node); 8]>::new());
        let mut position = 0;
        hir.for_each_child(at, &mut |child| {
            match child.part() {
                // It wraps its row's node, and the rest of it contains no name.
                Some(crate::node::Part::Span | crate::node::Part::JsxExpression) => {
                    spans.push(ChildSpan {
                        start: hir.start(child.row()),
                        end: self.c.end_of_node(self.file, child.row()),
                        position,
                        node: child,
                    })
                }
                Some(_) => parts.push((position, child)),
                None => spans.push(ChildSpan {
                    start: hir.start(child),
                    end: self.c.end_of_node(self.file, child),
                    position,
                    node: child,
                }),
            }
            position += 1;
            false
        });
        let is_in_order = spans
            .iter()
            .zip(spans.iter().skip(1))
            .all(|(a, b)| a.start <= b.start && a.end <= b.end);
        (is_in_order && !parts.spilled()).then(|| ManyChildren {
            spans: self.list(&spans),
            parts: self.list(&parts),
        })
    }

    pub fn node_kind(&mut self, node: NodeRef) -> Kind {
        self.valid(node)
            .map_or(Kind::Unknown, |(hir, node)| hir.kind(node))
    }

    pub fn node_data(&mut self, node: NodeRef) -> NodeData {
        self.valid(node)
            .map_or(NodeData::None, |(hir, node)| hir.data(node))
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
            Child::Constraint | Child::Default => match hir.data(node) {
                NodeData::TypeParam(parameter) if child == Child::Constraint => {
                    hir.node(hir[parameter].constraint)
                }
                NodeData::TypeParam(parameter) => hir.node(hir[parameter].default),
                _ => Node::NONE,
            },
        }
    }

    pub fn node_children(&mut self, of: NodeRef) -> &'c [Node] {
        if let Some(&known) = self.children.get(&of) {
            return known;
        }
        let Some((hir, node)) = self.valid(of) else {
            return &[];
        };
        let mut children: SmallVec<[Node; 8]> = SmallVec::new();
        hir.for_each_child(node, &mut |child| {
            children.push(child);
            false
        });
        let list = self.list(&children);
        if children.spilled() {
            self.children.insert(of, list);
        }
        list
    }

    pub fn node_span(&mut self, node: NodeRef) -> (u32, u32) {
        match self.valid(node) {
            // Finding a node's end takes the file's text, and the default library's text isn't
            // kept.
            Some((hir, at)) if !hir.text.is_empty() => {
                let (start, end) = (hir.start(at), self.c.end_of_node(node.file, at));
                // The HIR doesn't record a span for every derived node.
                match at.part().is_some()
                    && (end <= start || start == 0 && hir.start(at.row()) != 0)
                {
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

    /// `checker.getAccessedPropertyName(node)`: the name as written for a property access, or what
    /// `tryGetElementAccessExpressionName` finds for the key of an element access.
    pub fn accessed_property_name(&mut self, node: NodeRef) -> Option<&'p [u8]> {
        let e = self.expr_of(node)?;
        let name = match self.c.hir(node.file)[e].kind {
            hir::ExprKind::Dot { name, .. } => name,
            hir::ExprKind::Index { index, .. } => self.c.literal_key(node.file, index)?,
            _ => return None,
        };
        Some(crate::atom::written_name(self.c.atoms().bytes(name)))
    }

    /// The source text from `node`'s first token through its last.
    pub fn node_source_text(&mut self, node: NodeRef) -> &'p [u8] {
        let (start, end) = self.node_span(node);
        match self.valid(node) {
            Some((hir, _)) => hir
                .text
                .get(start as usize..end as usize)
                .unwrap_or_default(),
            None => b"",
        }
    }

    /// `isTypeOnlyImportOrExportDeclaration` if `with_parents`, else `node.isTypeOnly`.
    pub fn is_type_only(&mut self, node: NodeRef, with_parents: bool) -> bool {
        let Some((hir, at)) = self.valid(node) else {
            return false;
        };
        match (hir.data(at), hir.data(at.row())) {
            (NodeData::ImportSpec(s), _) => {
                hir[s].type_only || with_parents && hir[hir[s].import].type_only
            }
            (NodeData::ExportSpec(s), _) => {
                hir[s].type_only || with_parents && hir[hir[s].export].type_only
            }
            (data, NodeData::Stmt(s)) => match (hir[s].kind, data) {
                (StmtKind::Import(i), NodeData::Part(crate::node::Part::ImportClause, _)) => {
                    hir[i].type_only
                }
                (StmtKind::Import(i), NodeData::Part(crate::node::Part::NamedBindings, _)) => {
                    with_parents && hir.kind(at) == Kind::NamespaceImport && hir[i].type_only
                }
                (StmtKind::ImportEquals(i), NodeData::Stmt(_)) => {
                    hir[i].flags.contains(Flags::TYPE_ONLY)
                }
                (StmtKind::ExportNamed(e), NodeData::Stmt(_)) => !with_parents && hir[e].type_only,
                // `export type * from "m"` is type-only itself. In `export type * as ns from "m"` the clause is.
                (StmtKind::ExportStar { type_only, .. }, NodeData::Stmt(_)) => {
                    type_only
                        && (!with_parents
                            || hir.kind(at.with(crate::node::Part::ExportClause))
                                != Kind::NamespaceExport)
                }
                (
                    StmtKind::ExportStar { type_only, .. },
                    NodeData::Part(crate::node::Part::ExportClause, _),
                ) => with_parents && type_only,
                _ => false,
            },
            _ => false,
        }
    }

    /// The flags the HIR stores for `node`. Besides modifiers they include `?`, `...`, `!` and `*`.
    pub fn node_hir_flags(&mut self, node: NodeRef) -> Flags {
        self.valid(node)
            .map_or(Flags::empty(), |(hir, node)| hir.flags(node))
    }

    /// `getCombinedModifierFlags`
    pub fn node_modifier_flags(&mut self, node: NodeRef) -> ModifierFlags {
        let Some((hir, mut at)) = self.valid(node) else {
            return ModifierFlags::empty();
        };
        // `getCombinedFlags`: a binding element takes the flags of the declaration it's part of,
        // and a variable declaration also those of its list and statement.
        let mut depth = 0;
        while hir.kind(at) == Kind::BindingElement && depth < 4096 {
            at = hir.parent(hir.parent(at));
            depth += 1;
        }
        let mut flags = hir.flags(at);
        // Only a `declare` modifier counts as `ModifierFlags.Ambient`. A variable's is on its
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
                    ModuleName::Ident(_) if self.has_namespace_keyword(node.file, at) => {
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

    /// True if the `ModuleDeclaration` uses the `namespace` keyword. An inner part of
    /// `namespace a.b` has no keyword and counts too.
    fn has_namespace_keyword(&self, file: FileId, node: Node) -> bool {
        let hir = self.c.hir(file);
        let mut text = hir.text.get(hir.start(node) as usize..).unwrap_or_default();
        for modifier in [&b"export"[..], b"declare"] {
            text = text
                .strip_prefix(modifier)
                .map_or(text, |rest| rest.trim_ascii_start());
        }
        !text.starts_with(b"module")
    }

    // ───────────────────────────── from a node ─────────────────────────────

    /// `node.Symbol` of a declaration for which the binder has no table. `NONE` if it has no
    /// symbol.
    fn symbol_of_rejected_declaration(&self, file: FileId, decl: Decl) -> SymbolId {
        let found = match file == self.file {
            true => {
                let symbols = (self.symbols_of_declarations)
                    .get_or_init(|| self.c.symbols_of_declarations(file));
                symbols.get(&decl).copied()
            }
            false => self.c.symbols_of_declarations(file).get(&decl).copied(),
        };
        found.unwrap_or(SymbolId::NONE)
    }

    /// Classifies `node` if it's an expression, an identifier or a declaration's name.
    fn visited_kind(&self, node: NodeRef) -> Option<VisitedKind> {
        self.c.visited_kind(node.file, node.node, &|decl| {
            self.symbol_of_rejected_declaration(node.file, decl).some()
        })
    }

    pub fn type_from_type_node(&mut self, node: NodeRef) -> TypeId {
        match self.valid(node).map(|(hir, at)| hir.data(at)) {
            Some(NodeData::Type(ty)) => self.c.type_from_node(node.file, ty),
            _ => TypeId::ERROR,
        }
    }

    pub fn contextual_type(&mut self, node: NodeRef) -> Option<TypeId> {
        if let Some((hir, at)) = self.valid(node) {
            // A JSX element's tag name gets `getContextualJsxElementAttributesType`.
            let tag = hir.parent(at);
            if matches!(
                hir.kind(tag),
                Kind::JsxOpeningElement | Kind::JsxSelfClosingElement
            ) && hir.is_jsx_tag_name(at)
                && let NodeData::Expr(element) = hir.data(tag.row())
            {
                let outer = self.c.begin_recheck();
                let ty = self
                    .c
                    .contextual_jsx_element_attributes_type(node.file, element);
                self.c.end_recheck(outer);
                return ty;
            }
            // An object literal property's name gets `getContextualTypeForObjectLiteralElement`, the same as its value.
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
        // A `JsxExpression` that's an attribute's value has the contextual type of the expression
        // inside it. One that's a child has none.
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
        let is_pushed = self.push_contextual_type_of_enclosing_literal(node.file, e);
        let ty = self.c.contextual_type(node.file, e, ContextFlags::empty());
        if is_pushed {
            self.c.pop_contextual_type();
        }
        self.c.end_recheck(outer);
        ty
    }

    /// `pushCachedContextualType` for the literal that contains `e`, if it has many properties or elements. As during
    /// the check of the literal, its contextual type is then computed once for all of them. Computing it can take time
    /// linear in their number, because the type a pattern implies is built from all its properties. Returns true if a
    /// type was pushed.
    fn push_contextual_type_of_enclosing_literal(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let literal = match bound.parent_of_expr(e) {
            crate::bind::Parent::Prop(p) => bound.prop_owner[p.idx()],
            crate::bind::Parent::Expr(outer) => outer,
            _ => return false,
        };
        let has_many = literal.is_some()
            && match hir[literal].kind {
                ExprKind::Object(properties) => properties.len() > MANY,
                ExprKind::Array(elements) => elements.len() > MANY,
                _ => false,
            };
        // While control flow analysis is disabled, a reference that had a real type before has the error type.
        if !has_many || !self.c.flow_analysis_disabled.is_empty() {
            return false;
        }
        let known = self.expected_of_many.get(&(file, literal)).copied();
        let Some(expected) =
            known.or_else(|| self.c.contextual_type(file, literal, ContextFlags::empty()))
        else {
            return false;
        };
        // Don't cache a type the checker gave up on. It may resolve later, when more is known.
        if known.is_none() {
            if !self.c.flow_analysis_disabled.is_empty()
                || self.type_test(TypeTest::Unresolved, expected)
            {
                return false;
            }
            self.expected_of_many.insert((file, literal), expected);
        }
        self.c
            .push_contextual_type(file, literal, Some(expected), true);
        true
    }

    pub fn apparent_type_of_contextual_type(&mut self, node: NodeRef) -> Option<TypeId> {
        let e = self.expr_of(node)?;
        let outer = self.c.begin_recheck();
        let ty = self
            .c
            .apparent_type_of_contextual_type(node.file, e, ContextFlags::empty());
        self.c.end_recheck(outer);
        ty
    }

    pub fn contextual_type_for_argument_at_index(
        &mut self,
        call: NodeRef,
        index: u32,
    ) -> Option<TypeId> {
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
        // A JSX opening element resolves as its element.
        let at = match at.part() {
            Some(crate::node::Part::Opening) => at.row(),
            _ => at,
        };
        let e = self.expr_of(NodeRef { node: at, ..call })?;
        let is_call_like = matches!(
            hir[e].kind,
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) | ExprKind::Jsx(_)
        ) || matches!(
            hir[e].kind,
            ExprKind::Binary {
                op: BinOp::Instanceof,
                ..
            }
        ) || matches!(
            self.c.bound(call.file).parent_of_expr(e),
            Parent::ClassDecorator(_) | Parent::MemberDecorator(_) | Parent::ParamDecorator(_)
        );
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

    /// `context_free_type_of_expression` as a tool sees it when it asks before anything has resolved the call `node`.
    /// The call is resolved again, without a contextual type. Anything but a call gets plain
    /// `context_free_type_of_expression`.
    pub fn context_free_type_of_freshly_resolved_call(&mut self, node: NodeRef) -> TypeId {
        let Some(e) = self.expr_of(node) else {
            return TypeId::ERROR;
        };
        match self.c.hir(node.file)[e].kind {
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) => {
                (self.c).context_free_type_of_freshly_resolved_call(node.file, e)
            }
            _ => self.c.context_free_type_of_expression(node.file, e),
        }
    }

    /// The scope in which names at `node` are resolved.
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
                NodeData::Stmt(s) => bound.scope_of_stmt(s).some(),
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

/// `packageIdToPackageName`: the package name plus the path inside the package, which is everything
/// after the last `node_modules/`. `getPackageNameFromTypesPackageName` is not applied.
fn path_in_node_modules(path: &[u8]) -> Option<&[u8]> {
    const NODE_MODULES: &[u8] = b"/node_modules/";
    let at = bun_core::strings::last_index_of(path, NODE_MODULES)?;
    Some(&path[at + NODE_MODULES.len()..])
}

/// `a` for `a/b`, `@a/b` for `@a/b/c`. `None` for a path.
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
