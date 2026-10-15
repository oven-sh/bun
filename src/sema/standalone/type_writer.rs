//! The type at every expression and declaration name of a file: the content TypeScript's test
//! harness writes into `.types` baselines (`typeWriterWalker`, `GetTypeAtLocation`).

use super::enclosing_declaration::Enclosing;
use super::services::visited::VisitedKind;
use super::visit_node::VisitedNode;
use super::*;
use crate::bind::Decl;
use crate::node::{Kind, Node, NodeData, Part};

/// `typeWriterResult`
pub struct TypeAtLocation {
    pub start: u32,
    pub end: u32,
    pub type_text: String,
}

/// State carried from node to node during the type walk of a file.
struct TypeWalk {
    /// The last type printed for an expression, and its text. The parentheses around an expression
    /// and the name of a property access reuse it.
    text_of_expr: Vec<Option<(TypeId, String)>>,
}

impl Checker<'_, '_> {
    /// `typeWriterWalker.getTypes`. The file must have been checked, as in the harness.
    pub fn types_at_locations(&mut self, file: FileId) -> Vec<TypeAtLocation> {
        if self.is_flow_analysis_left_disabled(file) {
            self.disable_flow_analysis(file);
        }
        let hir = self.hir(file);
        let mut walk = TypeWalk {
            text_of_expr: vec![None; hir.exprs.len()],
        };
        let nodes = self.visited_nodes(file);
        let mut results = Vec::with_capacity(nodes.len());
        for node in nodes {
            self.write_type_of_visited_node(file, node, &mut walk, &mut results);
        }
        self.rechecked_exprs.clear();
        self.rechecked_members.clear();
        results
    }

    /// The position and the kind of each node of `file` whose type is the error type: the walk of
    /// `types_at_locations` without the printing. TypeScript produces the error type only where it
    /// reports an error or receives an error type as input, so in a file without errors each of
    /// these is a bug. Empty for a file whose semantic errors are not reported, or only partly
    /// reported. The file must have been checked.
    pub fn error_types_at_locations(&mut self, file: FileId) -> Vec<(u32, String)> {
        if !self.reports_semantic_errors(file) || self.is_plain_js(file) {
            return Vec::new();
        }
        if self.is_flow_analysis_left_disabled(file) {
            self.disable_flow_analysis(file);
        }
        let mut found = Vec::new();
        for node in self.visited_nodes(file) {
            if self.is_omitted_from_types(file, node.kind) {
                continue;
            }
            let ty = self.get_type_of_written_node(file, node);
            if self.is_error_type(ty) && !self.is_error_type_printed_as_any(file, node.node) {
                found.push((node.start, format!("{:?}", node.kind)));
            }
        }
        self.rechecked_exprs.clear();
        self.rechecked_members.clear();
        found
    }

    /// `writeTypeOrSymbol`, in the walk for types.
    fn write_type_of_visited_node(
        &mut self,
        file: FileId,
        node: VisitedNode,
        walk: &mut TypeWalk,
        results: &mut Vec<TypeAtLocation>,
    ) {
        if self.is_omitted_from_types(file, node.kind) {
            return;
        }
        let ty = self.get_type_of_written_node(file, node);
        let type_text = if ty == TypeId::ERROR && self.is_error_type_printed_as_any(file, node.node)
        {
            "any".to_owned()
        } else {
            self.type_text_of_visited_node(file, node, ty, walk)
        };
        // The other `NonNullExpression`s of a run of `!`, which have the same type: the outermost first.
        let inside = match node.kind {
            VisitedKind::Expression(e) => non_null_ends_in(self.hir(file), e),
            _ => &[],
        };
        let ends = [node.end]
            .into_iter()
            .chain(inside.iter().rev().map(|it| it.1));
        results.extend(ends.map(|end| TypeAtLocation {
            start: node.start,
            end,
            type_text: type_text.clone(),
        }));
    }

    fn type_text_of_visited_node(
        &mut self,
        file: FileId,
        VisitedNode { node, kind, .. }: VisitedNode,
        ty: TypeId,
        walk: &mut TypeWalk,
    ) -> String {
        let repeated = match kind {
            VisitedKind::Expression(e)
            | VisitedKind::Parenthesized(e, _)
            | VisitedKind::AccessName(e) => Some(e.idx()),
            _ => None,
        };
        if let Some(index) = repeated
            && let Some((written, text)) = &walk.text_of_expr[index]
            && *written == ty
        {
            return text.clone();
        }
        let scope = self.enclosing_scope_of_visited_node(file, kind);
        if let VisitedKind::DeclarationName(decl, _) | VisitedKind::SpecifierPropertyName(decl, _) =
            kind
        {
            self.enclosing_module_specifier_mode =
                self.mode_of_module_specifier_of_declaration(file, decl);
        }
        let hir = self.hir(file);
        let enclosing_declaration = Enclosing {
            variable: match hir.data(hir.parent(node)) {
                NodeData::VarDecl(declaration) => declaration,
                _ => VarDeclId::NONE,
            },
            ..Enclosing::at_scope(file, scope)
        };
        let text = self.type_to_string_for_baseline_with(ty, Some(enclosing_declaration));
        let text = crate::messages::text(&text);
        self.enclosing_module_specifier_mode = None;
        if let Some(index) = repeated {
            walk.text_of_expr[index] = Some((ty, text.clone()));
        }
        text
    }

    /// `getTypeOfNode`, preceded by the special case of `writeTypeOrSymbol` for the node after the
    /// `extends` of a class.
    fn get_type_of_written_node(&mut self, file: FileId, node: VisitedNode) -> TypeId {
        let hir = self.hir(file);
        if let VisitedKind::Expression(_)
        | VisitedKind::Parenthesized(..)
        | VisitedKind::AccessName(_) = node.kind
            && !hir.is_in_with(node.start)
        {
            // `IsExpressionWithTypeArgumentsInClassExtendsClause(node.Parent)`: the base type, unless it is `any` or there is none.
            let parent = hir.parent(node.node);
            // The base expressions of a class after the first are not wrapped in an
            // `ExpressionWithTypeArguments`.
            if matches!(parent.part(), Some(Part::Base | Part::Extends)) {
                let class = self.class_sym(file, hir.class_of(parent.row()));
                if let Some(&base) = self.base_types(class).first()
                    && !base.is_any()
                {
                    let this = self.intern(TypeData::ThisParam(class));
                    return self.type_with_this_argument(base, this);
                }
            }
        }
        self.get_type_of_visited_node(file, node.kind, node.start)
    }

    /// Whether `writeTypeOrSymbol` omits the node from the type walk.
    fn is_omitted_from_types(&self, file: FileId, kind: VisitedKind) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match kind {
            VisitedKind::Expression(e) => match hir[e].kind {
                // `IsPartOfTypeNode` treats the keyword `null` as a type wherever it appears.
                ExprKind::Null => true,
                // An assertion whose type node is reparsed from a `@type` or `@satisfies` tag.
                ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => {
                    ty.is_some() && hir.is_in_jsdoc(hir[ty].pos)
                }
                ExprKind::AsConst(_) => hir.is_js,
                _ => false,
            },
            // `GetMeaningFromDeclaration(node.Parent)` lacks `SemanticMeaningValue`. The name of a
            // type alias is printed anyway, and that of a namespace if it is
            // `ModuleInstanceStateInstantiated`.
            VisitedKind::DeclarationName(Decl::Interface(_) | Decl::TypeParam(_), _) => true,
            VisitedKind::DeclarationName(Decl::Module(m), _) => {
                matches!(hir[m].name, ModuleName::Ident(_))
                    && bound.module_instance_state[m.idx()] != ModuleInstanceState::Instantiated
            }
            // `IsPartOfTypeNode`: `const` is a type reference, and a `TypePredicate` a type node.
            VisitedKind::ConstOfAsConst(_) | VisitedKind::TypePredicateParameter(_) => true,
            // `isPartOfTypeNodeInParent`: of `A.B.C` only `C` and the whole name are direct
            // children of a type node.
            // In a heritage clause the same applies to the property accesses
            // (`isPartOfTypeExpressionWithTypeArguments`).
            VisitedKind::TypeReferenceName(node, index)
            | VisitedKind::HeritageClauseName(node, index)
            | VisitedKind::HeritageClausePropertyAccess(node, index) => {
                !matches!(hir[node].kind, TypeNodeKind::Ref { name, .. } if index as usize + 1 != name.len())
            }
            // The `b` of `typeof import("m").a.b` is not: `isPartOfTypeNodeInParent` excludes an
            // `ImportType` with `IsTypeOf`.
            VisitedKind::ImportTypeQualifierName(node, index) => {
                matches!(hir[node].kind, TypeNodeKind::Import { name, is_typeof: false, .. }
                    if index as usize + 1 == name.len())
            }
            _ => false,
        }
    }

    /// The exceptions of `writeTypeOrSymbol`: whether the error type of the node is printed as
    /// `any` even in a test without errors.
    fn is_error_type_printed_as_any(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        let parent = hir.parent(node);
        match hir.kind(parent) {
            // `IsBindingElement`, `IsPropertyAccessOrQualifiedName`, `IsMetaProperty`, of `node.Parent`; the names of specifiers
            // (`isImportStatementName`, `isExportStatementName`)
            Kind::BindingElement
            | Kind::PropertyAccessExpression
            | Kind::QualifiedName
            | Kind::MetaProperty
            | Kind::ImportSpecifier
            | Kind::ExportSpecifier => true,
            // `IsLabelName`
            _ if node.part() == Some(Part::Label) => true,
            // `IsGlobalScopeAugmentation(node.Parent)`
            Kind::ModuleDeclaration => matches!(hir.data(parent), NodeData::Stmt(s)
                if matches!(hir[s].kind, StmtKind::Module(m) if matches!(hir[m].name, ModuleName::Global))),
            // `isImportStatementName`
            Kind::ImportClause | Kind::ImportEqualsDeclaration => hir.name(parent) == node,
            // `isExportStatementName`
            Kind::ExportAssignment => hir.expression(parent) == node,
            // `isIntrinsicJsxTag`
            _ => matches!(hir.data(node), NodeData::Expr(tag)
                if hir.is_jsx_tag_name(node) && self.jsx_intrinsic_tag_name(file, tag).is_some()),
        }
    }

    /// Whether `flowAnalysisDisabled` is still set after `file` has been checked. `checkBlock` resets it at the end of a function
    /// or module block, so it only stays set for a reference outside any such block.
    fn is_flow_analysis_left_disabled(&mut self, file: FileId) -> bool {
        // A walk nests at most once per flow node.
        if self.bound(file).flow_places <= super::flow::MAX_FLOW_DEPTH {
            return false;
        }
        (0..self.hir(file).exprs.len() as u32).map(ExprId).any(|e| {
            self.p.flows_too_deep.get(&self.task, &(file, e)).is_some()
                && self.function_or_module_block_of(file, e) == crate::node::Node::FILE
        })
    }

    /// `GetModeForUsageLocation` of `TryGetModuleSpecifierFromDeclaration`, for an import or an
    /// export.
    fn mode_of_module_specifier_of_declaration(
        &self,
        file: FileId,
        decl: Decl,
    ) -> Option<ResolutionMode> {
        let (hir, files) = (self.hir(file), self.files());
        let written = match decl {
            Decl::ImportDefault(import) | Decl::ImportNamespace(import) => hir[import].mode,
            Decl::ImportSpec(spec) => hir[hir[spec].import].mode,
            Decl::ExportSpec(spec) => {
                let export = &hir[hir[spec].export];
                if export.spec.is_none() {
                    return None;
                }
                export.mode
            }
            Decl::ExportStarAs(stmt) => match hir[stmt].kind {
                StmtKind::ExportStar { mode, .. } => mode,
                _ => return None,
            },
            Decl::ImportEquals(import) => {
                return matches!(hir[import].target, ImportEqualsTarget::Require(_))
                    .then_some(ResolutionMode::Require);
            }
            _ => return None,
        };
        Some(files.mode_of_import(file, written))
    }
}

/// Placeholder printed for a node whose type is the error type: `error` (`IntrinsicName()`) if the
/// test has no errors, or else `any` (`typeWriterWalker.hadErrorBaseline`). The caller that has the
/// report of the test replaces it.
pub const ERROR_TYPE_TEXT: &str = "\u{1}error";
