//! Names that the emitted code reserves, and names no type may have: 2441 2529 18027 2818, 2725,
//! 2414 2427 2431 2457 2368.

use super::errors_operators::language_version;
use super::*;
use crate::resolve::{ModuleKind, ScriptTarget};

/// `NodeCheckFlagsContainsClassWithPrivateIdentifiers`
const CONTAINS_CLASS_WITH_PRIVATE_IDENTIFIERS: u8 = 1;
/// `NodeCheckFlagsContainsSuperPropertyInStaticInitializer`
const CONTAINS_SUPER_PROPERTY_IN_STATIC_INITIALIZER: u8 = 2;

fn is_reserved_type_name(text: Atom) -> bool {
    matches!(
        text,
        known::any
            | known::unknown
            | known::never
            | known::number
            | known::bigint
            | known::boolean
            | known::string
            | known::symbol
            | known::void
            | known::object
            | known::undefined
    )
}

impl Checker<'_, '_> {
    /// `checkCollisionsForDeclarationName` for a declaration, or for the identifier that names a
    /// variable, a parameter or a binding element. `text`: `name.Text()`. Few names can collide, so
    /// the name is tested first.
    #[inline]
    pub(super) fn check_collisions_for_declaration_name(
        &mut self,
        file: FileId,
        declaration: impl ToNode,
        text: Atom,
    ) {
        if matches!(
            text,
            known::require
                | known::exports
                | known::Object
                | known::Promise
                | known::WeakMap
                | known::WeakSet
                | known::Reflect
        ) || is_reserved_type_name(text)
        {
            self.check_collisions_for_declaration_named(file, self.hir(file).node(declaration));
        }
    }

    fn check_collisions_for_declaration_named(&mut self, file: FileId, declaration: Node) {
        let hir = self.hir(file);
        let (node, name) = match hir.data(declaration) {
            NodeData::Pat(_) => (hir.parent(declaration), declaration),
            _ => (declaration, hir.name(declaration)),
        };
        // `checkVariableLikeDeclaration`: `const a = require("m")` is an alias and is not checked
        // further.
        if matches!(hir.data(node), NodeData::VarDecl(d) if self.external_module_require_argument(file, d).is_some())
        {
            return;
        }
        self.check_collision_with_require_exports_in_generated_code(file, node, name);
        self.check_collision_with_global_object_in_generated_code(file, node, name);
        self.check_collision_with_global_promise_in_generated_code(file, node, name);
        // `recordPotentialCollisionWithWeakMapSetInGeneratedCode`, `recordPotentialCollisionWithReflectInGeneratedCode`
        if language_version(self) <= ScriptTarget::ES2021
            && [known::WeakMap, known::WeakSet, known::Reflect]
                .iter()
                .any(|&text| self.need_collision_check_for_identifier(file, node, name, text))
        {
            self.deferred_diagnostics.push(node);
        }
        if hir.kind(node).is_class_like() {
            self.check_type_name_is_reserved(file, node, hir.text(name), 2414);
            if !hir.is_ambient(node) {
                self.check_class_name_collision_with_object(file, name);
            }
        } else if hir.kind(node) == Kind::EnumDeclaration {
            self.check_type_name_is_reserved(file, node, hir.text(name), 2431);
        }
    }

    /// `errorSkippedOnNoEmit`
    fn error_skipped_on_no_emit(&mut self, file: FileId, node: Node, code: u32, args: &[Arg<'_>]) {
        if !self.p.files.options.no_emit {
            self.error(file, node, code, args);
        }
    }

    /// Whether the declaration `node` is at the top level of a file that is a module, and is not a
    /// namespace that emits nothing.
    fn is_emitted_at_top_level_of_module(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        let is_uninstantiated = matches!(hir.data(node), NodeData::Stmt(s) if matches!(hir[s].kind, StmtKind::Module(m)
            if self.bound(file).module_instance_state[m.idx()] != ModuleInstanceState::Instantiated));
        !is_uninstantiated
            && hir.get_declaration_container(node) == Node::FILE
            && self.files().module(file).is_module()
    }

    /// `checkCollisionWithRequireExportsInGeneratedCode`
    fn check_collision_with_require_exports_in_generated_code(
        &mut self,
        file: FileId,
        node: Node,
        name: Node,
    ) {
        if self.emit_module_format_of_file(file) < ModuleKind::Es2015
            && (self.need_collision_check_for_identifier(file, node, name, known::require)
                || self.need_collision_check_for_identifier(file, node, name, known::exports))
            && self.is_emitted_at_top_level_of_module(file, node)
        {
            let text = Arg::Atom(self.hir(file).text(name));
            self.error_skipped_on_no_emit(file, name, 2441, &[text, text]);
        }
    }

    /// `checkCollisionWithGlobalObjectInGeneratedCode`
    fn check_collision_with_global_object_in_generated_code(
        &mut self,
        file: FileId,
        node: Node,
        name: Node,
    ) {
        if !self.hir(file).kind(node).is_class_like()
            && self.need_collision_check_for_identifier(file, node, name, known::Object)
            && self.is_emitted_at_top_level_of_module(file, node)
            && self.emit_module_format_of_file(file) == ModuleKind::CommonJs
        {
            let text = Arg::Atom(known::Object);
            self.error_skipped_on_no_emit(file, name, 2441, &[text, text]);
        }
    }

    /// `checkCollisionWithGlobalPromiseInGeneratedCode`
    fn check_collision_with_global_promise_in_generated_code(
        &mut self,
        file: FileId,
        node: Node,
        name: Node,
    ) {
        // `NodeFlagsHasAsyncFunctions`
        let has_async_functions = |hir: &hir::File| {
            hir.fns.iter().any(|f| {
                f.flags.contains(Flags::ASYNC)
                    && !f.flags.intersects(Flags::GENERATOR | Flags::AMBIENT)
                    && !matches!(f.body, FnBody::None)
                    && matches!(
                        f.kind,
                        FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method
                    )
            })
        };
        if language_version(self) < ScriptTarget::ES2017
            && self.need_collision_check_for_identifier(file, node, name, known::Promise)
            && self.is_emitted_at_top_level_of_module(file, node)
            && has_async_functions(self.hir(file))
        {
            let text = Arg::Atom(known::Promise);
            self.error_skipped_on_no_emit(file, name, 2529, &[text, text]);
        }
    }

    /// `needCollisionCheckForIdentifier`
    fn need_collision_check_for_identifier(
        &self,
        file: FileId,
        node: Node,
        identifier: Node,
        name: Atom,
    ) -> bool {
        let hir = self.hir(file);
        if hir.text(identifier) != name {
            return false;
        }
        // `IsTypeOnlyImportOrExportDeclaration`
        let is_type_only = match hir.data(node) {
            NodeData::Part(Part::ImportClause, row) => {
                matches!(hir.data(row), NodeData::Stmt(s) if matches!(hir[s].kind, StmtKind::Import(i) if hir[i].type_only))
            }
            NodeData::ImportSpec(s) => hir[s].type_only || hir[hir[s].import].type_only,
            _ => {
                hir.kind(node) == Kind::ImportEqualsDeclaration
                    && hir.flags(node).contains(Flags::TYPE_ONLY)
            }
        };
        if hir.kind(node).is_class_element()
            || matches!(
                hir.kind(node),
                Kind::PropertySignature | Kind::MethodSignature | Kind::PropertyAssignment
            )
            || hir.is_ambient(node)
            || is_type_only
        {
            return false;
        }
        // An overload.
        let root = hir.get_root_declaration(node);
        let function = hir.function_of(hir.parent(root));
        hir.kind(root) != Kind::Parameter
            || function.is_some() && !matches!(hir[function].body, FnBody::None)
    }

    /// `nodeLinks.flags |= flag` for the block scopes that enclose `node`.
    fn mark_enclosing_block_scope_containers(&mut self, file: FileId, node: Node, flag: u8) {
        let hir = self.hir(file);
        let mut scope = hir.get_enclosing_block_scope_container(node);
        while scope.is_some() {
            *self.node_check_flags.entry(scope).or_default() |= flag;
            scope = hir.get_enclosing_block_scope_container(scope);
        }
    }

    /// `setNodeLinksForPrivateIdentifierScope` for a class member whose name is a private
    /// identifier.
    pub(super) fn set_node_links_for_private_identifier_scope(
        &mut self,
        file: FileId,
        m: MemberId,
    ) {
        if language_version(self) < ScriptTarget::ESNext
            || !self.p.files.options.use_define_for_class_fields
        {
            let node = self.hir(file).node(m);
            let flag = CONTAINS_CLASS_WITH_PRIVATE_IDENTIFIERS;
            self.mark_enclosing_block_scope_containers(file, node, flag);
        }
    }

    /// The part of `checkSuperExpression` that marks the scopes enclosing `super.x` in a static
    /// initializer.
    pub(super) fn mark_super_property_in_static_initializer(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let node = hir.node(e);
        let parent = hir.parent(node);
        if language_version(self) > ScriptTarget::ES2021
            || hir.kind(parent) == Kind::CallExpression && hir.expression(parent) == node
        {
            return;
        }
        let mut container = hir.get_super_container(node, true);
        while hir.kind(container) == Kind::ArrowFunction {
            container = hir.get_super_container(container, true);
        }
        let class = hir.class_of(hir.parent(container));
        if !matches!(
            hir.kind(container),
            Kind::PropertyDeclaration | Kind::ClassStaticBlockDeclaration
        ) || !hir.is_static(container)
            || class.is_none()
            || hir[class].extends.is_none()
        {
            return;
        }
        let sym = self.class_sym(file, class);
        if self.class_declaration_extends_null(sym) || self.base_types(sym).is_empty() {
            return;
        }
        let flag = CONTAINS_SUPER_PROPERTY_IN_STATIC_INITIALIZER;
        self.mark_enclosing_block_scope_containers(file, parent, flag);
        // `IsExternalOrCommonJSModule`
        if !self.files().module(file).is_module()
            && let Some(flags) = self.node_check_flags.get_mut(&Node::FILE)
        {
            *flags &= !flag;
        }
    }

    /// `produceDeferredDiagnostics`
    pub(super) fn produce_deferred_diagnostics(&mut self, file: FileId) {
        for node in std::mem::take(&mut self.deferred_diagnostics) {
            if self.hir(file).text(self.hir(file).name(node)) == known::Reflect {
                self.check_reflect_collision(file, node);
            } else {
                self.check_weak_map_set_collision(file, node);
            }
        }
        self.node_check_flags.clear();
    }

    pub(super) fn has_node_check_flag(&self, node: Node, flag: u8) -> bool {
        (self.node_check_flags.get(&node)).is_some_and(|flags| flags & flag != 0)
    }

    /// `checkWeakMapSetCollision`
    fn check_weak_map_set_collision(&mut self, file: FileId, node: Node) {
        let hir = self.hir(file);
        let scope = hir.get_enclosing_block_scope_container(node);
        if self.has_node_check_flag(scope, CONTAINS_CLASS_WITH_PRIVATE_IDENTIFIERS) {
            let text = Arg::Atom(hir.text(hir.name(node)));
            self.error_skipped_on_no_emit(file, node, 18027, &[text]);
        }
    }

    /// `checkReflectCollision`
    fn check_reflect_collision(&mut self, file: FileId, node: Node) {
        let hir = self.hir(file);
        let flag = CONTAINS_SUPER_PROPERTY_IN_STATIC_INITIALIZER;
        let has_collision = match hir.kind(node) {
            // The name of a class expression can only collide within its members.
            Kind::ClassExpression => (hir[hir.class_of(node)].members.iter())
                .any(|member| self.has_node_check_flag(hir.node(member), flag)),
            Kind::FunctionExpression => self.has_node_check_flag(node, flag),
            _ => self.has_node_check_flag(hir.get_enclosing_block_scope_container(node), flag),
        };
        if has_collision {
            let text = Arg::Atom(known::Reflect);
            self.error_skipped_on_no_emit(file, node, 2818, &[text, text]);
        }
    }

    /// `checkClassNameCollisionWithObject`
    fn check_class_name_collision_with_object(&mut self, file: FileId, name: Node) {
        if self.hir(file).text(name) == known::Object
            && self.emit_module_format_of_file(file) < ModuleKind::Es2015
        {
            let module = self.p.files.options.module.name();
            self.error(file, name, 2725, &[Arg::Bytes(module)]);
        }
    }

    /// `checkTypeNameIsReserved` for the name of `declaration`. `text`: `name.Text()`.
    #[inline]
    pub(super) fn check_type_name_is_reserved(
        &mut self,
        file: FileId,
        declaration: impl ToNode,
        text: Atom,
        code: u32,
    ) {
        if is_reserved_type_name(text) {
            let hir = self.hir(file);
            self.error(
                file,
                hir.name(hir.node(declaration)),
                code,
                &[Arg::Atom(text)],
            );
        }
    }
}
