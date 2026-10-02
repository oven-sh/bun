//! Names that what is emitted needs for itself: 18027 2818.

use super::errors::Diagnostic;
use super::*;
use crate::resolve::ScriptTarget;

impl Checker<'_> {
    /// `recordPotentialCollisionWithWeakMapSetInGeneratedCode`, `recordPotentialCollisionWithReflectInGeneratedCode`, and what they put
    /// off, of every declaration `checkCollisionsForDeclarationName` is called on.
    pub(super) fn check_x_collisions(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let options = &files.options;
        // `errorSkippedOnNoEmit`. `languageVersion <= ES2021`: no target is the latest. All of a declaration file is ambient.
        if options.no_emit_is_set
            || options.target == ScriptTarget::None
            || options.target > ScriptTarget::ES2021
            || hir.kind == FileKind::Declaration
        {
            return;
        }
        let reflect = files.atoms.lookup(b"Reflect");
        let names = [
            files.atoms.lookup(b"WeakMap"),
            files.atoms.lookup(b"WeakSet"),
            reflect,
        ];
        let mut declared: Vec<(Node, Atom)> = Vec::new();
        for symbol in &bound.symbols {
            if names.contains(&Some(symbol.name)) {
                declared.extend(symbol.decls.iter().map(|&d| (hir.node(d), symbol.name)));
            }
        }
        declared.retain(|&(node, _)| {
            self.is_checked_for_collisions(file, node)
                && need_collision_check_for_identifier(hir, node)
        });
        if declared.is_empty() {
            return;
        }
        let with_private_identifiers = containers_of_classes_with_private_identifiers(hir);
        let with_super = self.containers_of_super_property_in_static_initializer(file);
        for (node, name) in declared {
            let container = hir.get_enclosing_block_scope_container(node);
            let text = self.atom_text(name);
            let (code, args) = if Some(name) != reflect {
                // `checkWeakMapSetCollision`
                if !with_private_identifiers.contains(&container) {
                    continue;
                }
                (18027, vec![text])
            } else {
                // `checkReflectCollision`
                let has_collision = match hir.kind(node) {
                    Kind::ClassExpression => {
                        let mut members = hir[hir.class_of(node)].members.iter();
                        members.any(|m| with_super.contains(&hir.node(m)))
                    }
                    Kind::FunctionExpression => with_super.contains(&node),
                    _ => with_super.contains(&container),
                };
                if !has_collision {
                    continue;
                }
                (2818, vec![text.clone(), text])
            };
            let (start, end) = self.get_error_range_for_node(file, node);
            out.push(Diagnostic { start, code });
            self.note(start, end, code, args);
        }
    }

    /// Whether `checkCollisionsForDeclarationName` is called on the declaration `node`, which has an identifier for a name.
    fn is_checked_for_collisions(&self, file: FileId, node: Node) -> bool {
        let (hir, files) = (self.hir(file), self.files());
        let is_in_file = |statement: Node| hir.parent(statement) == Node::FILE;
        // `checkGrammarModuleElementContext`
        let is_in_module_element_context = |statement: Node| {
            matches!(
                hir.kind(hir.parent(statement)),
                Kind::SourceFile | Kind::ModuleBlock | Kind::ModuleDeclaration
            )
        };
        // `checkExternalImportOrExportDeclaration`. Elsewhere a module can only be named in what is ambient.
        let is_import_checked = |i: ImportId| hir[i].spec.is_some() && is_in_file(hir.node(i));
        match hir.data(node) {
            // `const a = require("m")` in JavaScript is an alias, and looked at no further.
            NodeData::VarDecl(d) => !matches!(
                self.bound(file).required_by(hir, hir[d].pat),
                Some((_, None))
            ),
            NodeData::PatProp(_) | NodeData::PatElem(_) | NodeData::Param(_) => true,
            NodeData::Expr(_) => {
                matches!(
                    hir.kind(node),
                    Kind::FunctionExpression | Kind::ClassExpression
                )
            }
            NodeData::Stmt(s) => match hir[s].kind {
                StmtKind::Fn(_) | StmtKind::Class(_) | StmtKind::Enum(_) => true,
                StmtKind::Module(_) => is_in_module_element_context(node),
                StmtKind::ImportEquals(i) => match hir[i].target {
                    ImportEqualsTarget::Entity(_) => is_in_module_element_context(node),
                    ImportEqualsTarget::Require(spec) => spec.is_some() && is_in_file(node),
                },
                _ => false,
            },
            NodeData::Part(Part::ImportClause | Part::NamedBindings, row) => {
                matches!(hir.data(row), NodeData::Stmt(s) if matches!(hir[s].kind, StmtKind::Import(i) if is_import_checked(i)))
            }
            // `checkImportDeclaration`: of a module that is there.
            NodeData::ImportSpec(s) => {
                let import = &hir[hir[s].import];
                let mode = files.mode_of_import(file, import.mode);
                is_import_checked(hir[s].import)
                    && files
                        .module_of_specifier_as(file, import.spec, mode)
                        .is_some()
            }
            _ => false,
        }
    }

    /// `checkSuperExpression`: what gets `NodeCheckFlagsContainsSuperPropertyInStaticInitializer`.
    fn containers_of_super_property_in_static_initializer(&mut self, file: FileId) -> Vec<Node> {
        let hir = self.hir(file);
        let is_module = self.files().module(file).is_module();
        let index = self.exprs_by_kind(file);
        let mut marked = Vec::new();
        for &e in index.of(ExprTag::Super) {
            let node = hir.node(e);
            let parent = hir.parent(node);
            if hir.kind(parent) == Kind::CallExpression && hir.expression(parent) == node {
                continue;
            }
            let mut container = hir.get_super_container(node, true);
            while hir.kind(container) == Kind::ArrowFunction {
                container = hir.get_super_container(container, true);
            }
            let class = hir.class_of(hir.parent(container));
            if class.is_none()
                || !matches!(
                    hir.kind(container),
                    Kind::PropertyDeclaration | Kind::ClassStaticBlockDeclaration
                )
                || !hir.is_static(container)
                || hir[class].extends.is_none()
            {
                continue;
            }
            // It returns before it marks anything: `classDeclarationExtendsNull`, `baseClassType == nil`.
            let sym = self.class_sym(file, class);
            if self.class_declaration_extends_null(sym) || self.base_types(sym).is_empty() {
                continue;
            }
            mark_block_scope_containers(hir, parent, &mut marked);
        }
        // `IsExternalOrCommonJSModule`
        marked.retain(|&scope| scope != Node::FILE || is_module);
        marked
    }
}

/// `GetEnclosingBlockScopeContainer`, over and over. What is around what is marked is marked.
fn mark_block_scope_containers(hir: &File, from: Node, marked: &mut Vec<Node>) {
    let mut scope = hir.get_enclosing_block_scope_container(from);
    while scope.is_some() && !marked.contains(&scope) {
        marked.push(scope);
        scope = hir.get_enclosing_block_scope_container(scope);
    }
}

/// `setNodeLinksForPrivateIdentifierScope`: what gets `NodeCheckFlagsContainsClassWithPrivateIdentifiers`.
fn containers_of_classes_with_private_identifiers(hir: &File) -> Vec<Node> {
    let mut marked = Vec::new();
    for (m, member) in hir.members.iter().enumerate() {
        let node = hir.node(MemberId(m as u32));
        if matches!(member.key, PropKey::Private(_))
            && matches!(
                hir.kind(node),
                Kind::PropertyDeclaration
                    | Kind::MethodDeclaration
                    | Kind::GetAccessor
                    | Kind::SetAccessor
            )
            && hir.class_of(hir.parent(node)).is_some()
        {
            mark_block_scope_containers(hir, node, &mut marked);
        }
    }
    marked
}

/// `needCollisionCheckForIdentifier`, of a declaration that is no member.
fn need_collision_check_for_identifier(hir: &File, node: Node) -> bool {
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
    let root = hir.get_root_declaration(node);
    // An overload.
    let is_parameter_of_signature = hir.kind(root) == Kind::Parameter
        && hir
            .fns
            .get(hir.function_of(hir.parent(root)).idx())
            .is_none_or(|function| matches!(function.body, FnBody::None));
    !hir.is_ambient(node) && !is_type_only && !is_parameter_of_signature
}
