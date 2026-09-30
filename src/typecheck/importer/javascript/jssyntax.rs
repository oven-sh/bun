// Port of jsErrorAtRange, checkJSDecoratorSyntax and checkJSSyntax of internal/parser/parser.go as a pass over the tree of a JavaScript file after its reparse: the nodes are checked in the order in which upstream's parser checks them.
use super::ParseDiagnostic;
use super::tree::{
    ChildMember, bool_member, kind_member, list_member, members_in_source_order, modifier_nodes,
    name, node_member, type_node, type_parameter_list,
};
use crate::ast::{
    FileBuilder, Kind, ModifierFlags, NodeFlags, NodeId, NodeListId, is_function_like_kind,
    is_modifier_kind, modifier_to_flag,
};
use crate::core::{TextRange, new_text_range};
use crate::diagnostics::{self, MessageId};
use crate::scanner::{skip_trivia, token_to_string};

struct JsSyntaxChecker<'b> {
    b: &'b FileBuilder,
    // Parser.jsDiagnostics
    js_diagnostics: Vec<ParseDiagnostic>,
}

// ast.CanHaveIllegalDecorators
fn can_have_illegal_decorators(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::FunctionDeclaration
            | Kind::Constructor
            | Kind::IndexSignature
            | Kind::ClassStaticBlockDeclaration
            | Kind::MissingDeclaration
            | Kind::VariableStatement
            | Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::EnumDeclaration
            | Kind::ModuleDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::ImportDeclaration
            | Kind::JSImportDeclaration
            | Kind::NamespaceExportDeclaration
            | Kind::ExportDeclaration
            | Kind::ExportAssignment
    )
}

// ast.CanHaveDecorators
fn can_have_decorators(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::Parameter
            | Kind::PropertyDeclaration
            | Kind::MethodDeclaration
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::ClassExpression
            | Kind::ClassDeclaration
    )
}

// Node.QuestionToken of the three kinds that checkJSSyntax asks: the question token of a parameter, else the postfix token when it is a question mark.
fn question_token(b: &FileBuilder, node: NodeId) -> NodeId {
    if b.kind(node) == Kind::Parameter {
        return node_member(b, node, b"QuestionToken");
    }
    let postfix = node_member(b, node, b"PostfixToken");
    if !postfix.is_nil() && b.kind(postfix) == Kind::QuestionToken {
        return postfix;
    }
    NodeId::NIL
}

// True when a node of the list was not made by the reparser.
fn some_not_reparsed(b: &FileBuilder, list: NodeListId) -> bool {
    b.list_nodes(list)
        .iter()
        .any(|n| !b.flags(*n).intersects(NodeFlags::REPARSED))
}

// The kinds that a parse function passes to checkJSSyntax: the accessors and the signatures of a type are parsed with ParseFlagsType and are not checked, nor are their parameters.
fn is_check_site(b: &FileBuilder, node: NodeId, parent: NodeId, grandparent: NodeId) -> bool {
    let in_type_member = |holder: NodeId| {
        matches!(
            b.kind(holder),
            Kind::TypeLiteral | Kind::InterfaceDeclaration | Kind::MappedType
        )
    };
    match b.kind(node) {
        Kind::VariableStatement
        | Kind::VariableDeclaration
        | Kind::FunctionDeclaration
        | Kind::ClassDeclaration
        | Kind::ClassExpression
        | Kind::HeritageClause
        | Kind::Constructor
        | Kind::MethodDeclaration
        | Kind::PropertyDeclaration
        | Kind::InterfaceDeclaration
        | Kind::TypeAliasDeclaration
        | Kind::EnumDeclaration
        | Kind::ImportEqualsDeclaration
        | Kind::ImportDeclaration
        | Kind::ImportSpecifier
        | Kind::ExportAssignment
        | Kind::ExportDeclaration
        | Kind::ExportSpecifier
        | Kind::ArrowFunction
        | Kind::NonNullExpression
        | Kind::CallExpression
        | Kind::TaggedTemplateExpression
        | Kind::FunctionExpression
        | Kind::NewExpression => true,
        // A cast that the reparser made is never passed to checkJSSyntax: its type is a reparsed clone.
        Kind::SatisfiesExpression | Kind::AsExpression => {
            !b.flags(type_node(b, node)).intersects(NodeFlags::REPARSED)
        }
        Kind::ModuleDeclaration => {
            b.kind(name(b, node)) == Kind::Identifier
                && kind_member(b, node, b"Keyword") != Kind::GlobalKeyword
        }
        Kind::IndexSignature => matches!(
            b.kind(parent),
            Kind::ClassDeclaration | Kind::ClassExpression
        ),
        Kind::GetAccessor | Kind::SetAccessor => !in_type_member(parent),
        Kind::Parameter => match b.kind(parent) {
            Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::MethodDeclaration
            | Kind::Constructor => true,
            Kind::GetAccessor | Kind::SetAccessor => !in_type_member(grandparent),
            _ => false,
        },
        _ => false,
    }
}

impl JsSyntaxChecker<'_> {
    // The diagnostic of jsErrorAtRange: its range starts after the trivia of the node.
    fn new_diagnostic(
        &self,
        loc: TextRange,
        message: MessageId,
        args: &[&[u8]],
    ) -> ParseDiagnostic {
        ParseDiagnostic {
            message,
            loc: new_text_range(skip_trivia(self.b.source_text(), loc.pos()), loc.end()),
            args: args.iter().map(|arg| arg.to_vec()).collect(),
            related_information: Vec::new(),
        }
    }

    fn js_error_at_range(&mut self, loc: TextRange, message: MessageId, args: &[&[u8]]) {
        let diagnostic = self.new_diagnostic(loc, message, args);
        self.js_diagnostics.push(diagnostic);
    }

    fn check_js_decorator_syntax(&mut self, node: NodeId) {
        let b = self.b;
        let modifiers = modifier_nodes(b, node);
        if modifiers.is_empty() {
            return;
        }
        let is_decorator = |m: &NodeId| b.kind(*m) == Kind::Decorator;

        if can_have_illegal_decorators(b.kind(node)) {
            if let Some(modifier) = modifiers.iter().find(|m| is_decorator(m)) {
                self.js_error_at_range(
                    b.loc(*modifier),
                    diagnostics::DECORATORS_ARE_NOT_VALID_HERE,
                    &[],
                );
            }
        } else if can_have_decorators(b.kind(node)) {
            let Some(decorator_index) = modifiers.iter().position(is_decorator) else {
                return;
            };
            if b.kind(node) != Kind::ClassDeclaration {
                return;
            }
            let Some(export_index) = modifiers
                .iter()
                .position(|m| b.kind(*m) == Kind::ExportKeyword)
            else {
                return;
            };
            let default_index = modifiers
                .iter()
                .position(|m| b.kind(*m) == Kind::DefaultKeyword);
            let decorator = modifiers.get(decorator_index).copied().unwrap_or_default();
            if decorator_index > export_index
                && default_index.is_some_and(|default_index| decorator_index < default_index)
            {
                // Decorator between `export` and `default`
                self.js_error_at_range(
                    b.loc(decorator),
                    diagnostics::DECORATORS_ARE_NOT_VALID_HERE,
                    &[],
                );
            } else if decorator_index < export_index {
                // Find a trailing decorator after the export keyword
                let trailing_decorator = modifiers
                    .iter()
                    .skip(export_index)
                    .find(|m| is_decorator(m));
                if let Some(trailing_decorator) = trailing_decorator {
                    let mut diag = self.new_diagnostic(
                        b.loc(*trailing_decorator),
                        diagnostics::DECORATORS_MAY_NOT_APPEAR_AFTER_EXPORT_OR_EXPORT_DEFAULT_IF_THEY_ALSO_APPEAR_BEFORE_EXPORT,
                        &[],
                    );
                    diag.related_information.push(self.new_diagnostic(
                        b.loc(decorator),
                        diagnostics::DECORATOR_USED_BEFORE_EXPORT_HERE,
                        &[],
                    ));
                    self.js_diagnostics.push(diag);
                }
            }
        }
    }

    fn check_js_syntax(&mut self, node: NodeId) {
        let b = self.b;
        let flags = b.flags(node);
        if !flags.intersects(NodeFlags::JAVA_SCRIPT_FILE)
            || flags.intersects(NodeFlags::JSDOC | NodeFlags::REPARSED)
        {
            return;
        }
        let kind = b.kind(node);
        match kind {
            Kind::Parameter
            | Kind::PropertyDeclaration
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::Constructor
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::FunctionExpression
            | Kind::FunctionDeclaration
            | Kind::ArrowFunction
            | Kind::VariableDeclaration
            | Kind::IndexSignature => {
                if matches!(
                    kind,
                    Kind::Parameter | Kind::PropertyDeclaration | Kind::MethodDeclaration
                ) {
                    let token = question_token(b, node);
                    if !token.is_nil()
                        && !b.flags(token).intersects(NodeFlags::REPARSED)
                        && b.kind(token) == Kind::QuestionToken
                    {
                        self.js_error_at_range(
                            b.loc(token),
                            diagnostics::THE_0_MODIFIER_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                            &[b"?"],
                        );
                    }
                }
                let t = type_node(b, node);
                if is_function_like_kind(kind) && node_member(b, node, b"Body").is_nil() {
                    self.js_error_at_range(
                        b.loc(node),
                        diagnostics::SIGNATURE_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[],
                    );
                } else if !t.is_nil() && !b.flags(t).intersects(NodeFlags::REPARSED) {
                    self.js_error_at_range(
                        b.loc(t),
                        diagnostics::TYPE_ANNOTATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[],
                    );
                }
            }
            Kind::ImportDeclaration => {
                let clause = node_member(b, node, b"ImportClause");
                if !clause.is_nil() && kind_member(b, clause, b"PhaseModifier") == Kind::TypeKeyword
                {
                    self.js_error_at_range(
                        b.loc(node),
                        diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[b"import type"],
                    );
                }
            }
            Kind::ExportDeclaration => {
                if bool_member(b, node, b"IsTypeOnly") {
                    self.js_error_at_range(
                        b.loc(node),
                        diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[b"export type"],
                    );
                }
            }
            Kind::ImportSpecifier => {
                if bool_member(b, node, b"IsTypeOnly") {
                    self.js_error_at_range(
                        b.loc(node),
                        diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[b"import...type"],
                    );
                }
            }
            Kind::ExportSpecifier => {
                if bool_member(b, node, b"IsTypeOnly") {
                    self.js_error_at_range(
                        b.loc(node),
                        diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[b"export...type"],
                    );
                }
            }
            Kind::ImportEqualsDeclaration => {
                self.js_error_at_range(
                    b.loc(node),
                    diagnostics::X_IMPORT_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                    &[],
                );
            }
            Kind::ExportAssignment => {
                if bool_member(b, node, b"IsExportEquals") {
                    self.js_error_at_range(
                        b.loc(node),
                        diagnostics::X_EXPORT_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[],
                    );
                }
            }
            Kind::HeritageClause => {
                if kind_member(b, node, b"Token") == Kind::ImplementsKeyword {
                    self.js_error_at_range(
                        b.loc(node),
                        diagnostics::X_IMPLEMENTS_CLAUSES_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[],
                    );
                }
            }
            Kind::InterfaceDeclaration => {
                self.js_error_at_range(
                    b.loc(name(b, node)),
                    diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                    &[b"interface"],
                );
            }
            Kind::ModuleDeclaration => {
                self.js_error_at_range(
                    b.loc(name(b, node)),
                    diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                    &[token_to_string(kind_member(b, node, b"Keyword"))],
                );
            }
            Kind::TypeAliasDeclaration => {
                self.js_error_at_range(
                    b.loc(name(b, node)),
                    diagnostics::TYPE_ALIASES_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                    &[],
                );
            }
            Kind::EnumDeclaration => {
                self.js_error_at_range(
                    b.loc(name(b, node)),
                    diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                    &[b"enum"],
                );
            }
            Kind::NonNullExpression => {
                self.js_error_at_range(
                    b.loc(node),
                    diagnostics::NON_NULL_ASSERTIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                    &[],
                );
            }
            Kind::AsExpression => {
                self.js_error_at_range(
                    b.loc(type_node(b, node)),
                    diagnostics::TYPE_ASSERTION_EXPRESSIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                    &[],
                );
            }
            Kind::SatisfiesExpression => {
                self.js_error_at_range(
                    b.loc(type_node(b, node)),
                    diagnostics::TYPE_SATISFACTION_EXPRESSIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                    &[],
                );
            }
            _ => {}
        }
        // Check decorator placement in JS files
        self.check_js_decorator_syntax(node);
        // Check absence of type parameters, type arguments and non-JavaScript modifiers
        match kind {
            Kind::ClassDeclaration
            | Kind::ClassExpression
            | Kind::MethodDeclaration
            | Kind::Constructor
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::FunctionExpression
            | Kind::FunctionDeclaration
            | Kind::ArrowFunction
            | Kind::VariableStatement
            | Kind::PropertyDeclaration => {
                if !matches!(kind, Kind::VariableStatement | Kind::PropertyDeclaration) {
                    let list = type_parameter_list(b, node);
                    if !list.is_nil() && some_not_reparsed(b, list) {
                        self.js_error_at_range(
                            b.list_loc(list),
                            diagnostics::TYPE_PARAMETER_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                            &[],
                        );
                    }
                }
                for modifier in modifier_nodes(b, node) {
                    let modifier_kind = b.kind(*modifier);
                    if !b.flags(*modifier).intersects(NodeFlags::REPARSED)
                        && modifier_kind != Kind::Decorator
                        && !modifier_to_flag(modifier_kind).intersects(ModifierFlags::JAVA_SCRIPT)
                    {
                        self.js_error_at_range(
                            b.loc(*modifier),
                            diagnostics::THE_0_MODIFIER_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                            &[token_to_string(modifier_kind)],
                        );
                    }
                }
            }
            Kind::Parameter => {
                if modifier_nodes(b, node)
                    .iter()
                    .any(|m| is_modifier_kind(b.kind(*m)))
                {
                    self.js_error_at_range(
                        b.list_loc(list_member(b, node, b"modifiers")),
                        diagnostics::PARAMETER_MODIFIERS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[],
                    );
                }
            }
            Kind::CallExpression
            | Kind::NewExpression
            | Kind::ExpressionWithTypeArguments
            | Kind::JsxSelfClosingElement
            | Kind::JsxOpeningElement
            | Kind::TaggedTemplateExpression => {
                let list = list_member(b, node, b"TypeArguments");
                if !list.is_nil() && some_not_reparsed(b, list) {
                    self.js_error_at_range(
                        b.list_loc(list),
                        diagnostics::TYPE_ARGUMENTS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
                        &[],
                    );
                }
            }
            _ => {}
        }
    }

    // What parseClassDeclarationOrExpression checks after the class itself: the types of its extends clause.
    fn check_heritage_of_class(&mut self, node: NodeId) {
        let b = self.b;
        for clause in b.list_nodes(list_member(b, node, b"HeritageClauses")) {
            if b.flags(*clause).intersects(NodeFlags::REPARSED) {
                continue;
            }
            if kind_member(b, *clause, b"Token") == Kind::ExtendsKeyword {
                for expr in b.list_nodes(list_member(b, *clause, b"Types")) {
                    self.check_js_syntax(*expr);
                }
            }
        }
    }
}

enum Step {
    Enter(NodeId),
    Leave(NodeId),
}

// SourceFile.JSDiagnostics of a JavaScript file: every node that a parse function of upstream passes to checkJSSyntax is checked when its children are, which is when the parser has finished it and reparsed its JSDoc.
pub fn check_js_syntax_of_source_file(
    b: &FileBuilder,
    source_file: NodeId,
) -> Vec<ParseDiagnostic> {
    let mut checker = JsSyntaxChecker {
        b,
        js_diagnostics: Vec::new(),
    };
    let mut path: Vec<NodeId> = Vec::new();
    let mut members: Vec<ChildMember> = Vec::new();
    let mut steps = vec![Step::Enter(source_file)];
    while let Some(step) = steps.pop() {
        match step {
            Step::Enter(node) => {
                // A node that the reparser made is checked nowhere, nor is anything under it.
                if b.flags(node).intersects(NodeFlags::REPARSED) {
                    continue;
                }
                path.push(node);
                steps.push(Step::Leave(node));
                members.clear();
                members_in_source_order(b, node, &mut members);
                for member in members.iter().rev() {
                    if member.is_list {
                        let items = b.list_nodes(NodeListId(member.word));
                        steps.extend(items.iter().rev().map(|item| Step::Enter(*item)));
                    } else {
                        steps.push(Step::Enter(NodeId(member.word)));
                    }
                }
            }
            Step::Leave(node) => {
                path.pop();
                let parent = path.last().copied().unwrap_or_default();
                let grandparent = path
                    .len()
                    .checked_sub(2)
                    .and_then(|at| path.get(at))
                    .copied()
                    .unwrap_or_default();
                if is_check_site(b, node, parent, grandparent) {
                    checker.check_js_syntax(node);
                }
                if matches!(b.kind(node), Kind::ClassDeclaration | Kind::ClassExpression)
                    && b.flags(node).intersects(NodeFlags::JAVA_SCRIPT_FILE)
                {
                    checker.check_heritage_of_class(node);
                }
            }
        }
    }
    checker.js_diagnostics
}
