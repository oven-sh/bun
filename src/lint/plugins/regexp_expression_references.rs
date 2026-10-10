#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/utils/ast-utils/extract-expression-references.ts` and `lib/utils/get-usage-of-pattern.ts`
//! of eslint-plugin-regexp. What a generator yields upstream is a list here, in the same order.

use crate::regexp_ast_utils::{find_function, get_string_if_constant};
use bun_lint::prelude::*;
use bun_lint::utils::{Target, TargetKind, is_expression_statement};
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;

/// upstream's `ExpressionReference`. The `node` of the first three can be an identifier that is no
/// expression here: the `Pat` that declares the variable, or what [`Reference::node`] gives.
#[derive(Copy, Clone, Debug)]
pub(crate) enum ExpressionReference<'a> {
    /// The result of the expression is not referenced.
    Unused { node: Node<'a> },
    /// Unknown what the expression was referenced for.
    Unknown { node: Node<'a> },
    /// The expression is exported.
    Exported { node: Node<'a> },
    /// The expression is referenced for member access.
    Member {
        node: Expr<'a>,
        member_expression: Expr<'a>,
    },
    /// The expression is referenced for destructuring.
    Destructuring { node: Expr<'a>, pattern: Target<'a> },
    /// The expression is referenced to give as an argument.
    Argument {
        node: Expr<'a>,
        call_expression: Expr<'a>,
    },
    /// The expression is referenced to call.
    Call { node: Expr<'a> },
    /// The expression is referenced for iteration.
    Iteration { node: Expr<'a>, for_of: Stmt<'a> },
}

impl<'a> ExpressionReference<'a> {
    pub(crate) fn node(&self) -> Node<'a> {
        match *self {
            Self::Unused { node } | Self::Unknown { node } | Self::Exported { node } => node,
            Self::Member { node, .. }
            | Self::Destructuring { node, .. }
            | Self::Argument { node, .. }
            | Self::Call { node }
            | Self::Iteration { node, .. } => node.into(),
        }
    }
}

/// A `Variable` of ESLint. One of the global scope that the file does not declare is no `Symbol`.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Variable<'a> {
    Declared(Symbol<'a>),
    Global(Name<'a>),
}

/// upstream's `findVariable`
fn find_variable<'a>(identifier: Target<'a>) -> Option<Variable<'a>> {
    let TargetKind::Ident(name) = identifier.kind() else {
        return None;
    };
    let node = Node::from(identifier);
    match node.scope().resolve_name(name) {
        Some(symbol) => Some(Variable::Declared(symbol)),
        None => node
            .file()
            .global_named(name)
            .map(|_| Variable::Global(name)),
    }
}

/// What upstream's `alreadyChecked.functions` has for a function.
struct CheckedFunction {
    already_indexes: FxHashSet<usize>,
    /// Where the first `RestElement` among its parameters is: upstream looks for it each time.
    rest_index: Option<usize>,
}

/// upstream's `AlreadyChecked`
#[derive(Default)]
struct AlreadyChecked<'a> {
    variables: FxHashSet<Variable<'a>>,
    functions: FxHashMap<Func<'a>, CheckedFunction>,
}

#[derive(Default)]
struct Extractor<'a> {
    already_checked: AlreadyChecked<'a>,
    /// What upstream yields.
    references: Vec<ExpressionReference<'a>>,
    /// What the loops of `iterateReferencesForVariable` have not come to yet, the next one last.
    /// Upstream recurses, as deep as a chain of `const b = a` is long.
    read_references: Vec<Reference<'a>>,
}

/// upstream's `extractExpressionReferences`
pub(crate) fn extract_expression_references<'a>(node: Expr<'a>) -> Vec<ExpressionReference<'a>> {
    let mut extractor = Extractor::default();
    extractor.iterate_references_for_expression(node);
    extractor.iterate_read_references()
}

/// upstream's `extractExpressionReferencesForVariable`
pub(crate) fn extract_expression_references_for_variable<'a>(
    node: Target<'a>,
) -> Vec<ExpressionReference<'a>> {
    let mut extractor = Extractor::default();
    extractor.iterate_references_for_variable(node);
    extractor.iterate_read_references()
}

impl<'a> Extractor<'a> {
    /// upstream's `iterateReferencesForExpression`
    fn iterate_references_for_expression(&mut self, expression: Expr<'a>) {
        let mut node = expression;
        let mut parent = node.parent();
        // A `ChainExpression` is no node.
        while let Node::Expr(outer) = parent
            && match outer.kind() {
                ExprKind::NonNull(_) => true,
                ExprKind::As { .. } | ExprKind::AsConst(_) => !outer.is_angle_bracket_assertion(),
                _ => false,
            }
        {
            node = outer;
            parent = node.parent();
        }
        let unknown = ExpressionReference::Unknown { node: node.into() };
        let reference = match parent {
            Node::Stmt(statement) if is_expression_statement(statement) => {
                ExpressionReference::Unused { node: node.into() }
            }
            Node::Expr(member_expression) if ast_utils::is_member_expression(member_expression) => {
                match member_expression.kind() {
                    ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == node => {
                        ExpressionReference::Member {
                            node,
                            member_expression,
                        }
                    }
                    _ => unknown,
                }
            }
            Node::Expr(outer) => match outer.kind() {
                // In a pattern it is an `AssignmentPattern`.
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if value == node && !outer.is_assignment_target() => {
                    return self.iterate_references_for_es_pattern(node, target.into());
                }
                ExprKind::Call(call) => match call.args().index_of_start(node.span().start) {
                    Some(arg_index) => {
                        if call.callee().tag() == ExprTag::Ident
                            && let Some(func) = find_function(call.callee())
                        {
                            return self
                                .iterate_references_for_function_argument(node, func, arg_index);
                        }
                        ExpressionReference::Argument {
                            node,
                            call_expression: outer,
                        }
                    }
                    None => ExpressionReference::Call { node },
                },
                _ if is_used_in_test(parent, node) => return,
                _ => unknown,
            },
            Node::VarDecl(declarator) if declarator.init() == Some(node) => {
                if declarator.parent().as_stmt().is_some_and(Stmt::is_exported) {
                    let node = node.into();
                    self.references.push(ExpressionReference::Exported { node });
                }
                return self.iterate_references_for_es_pattern(node, declarator.pat().into());
            }
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::ExportDefault(_) => ExpressionReference::Exported { node: node.into() },
                StmtKind::ForOf { expr, .. } if expr == node => ExpressionReference::Iteration {
                    node,
                    for_of: statement,
                },
                _ if is_used_in_test(parent, node) => return,
                _ => unknown,
            },
            _ => unknown,
        };
        self.references.push(reference);
    }

    /// upstream's `iterateReferencesForESPattern`. The `left` of an `AssignmentPattern` is what a
    /// `Param` has as its `pat`.
    fn iterate_references_for_es_pattern(&mut self, expression: Expr<'a>, target: Target<'a>) {
        let reference = match target.kind() {
            TargetKind::Ident(_) => return self.iterate_references_for_variable(target),
            TargetKind::Object | TargetKind::Array => ExpressionReference::Destructuring {
                node: expression,
                pattern: target,
            },
            TargetKind::Other(_) => ExpressionReference::Unknown {
                node: expression.into(),
            },
        };
        self.references.push(reference);
    }

    /// upstream's `iterateReferencesForVariable`, but for its loop.
    fn iterate_references_for_variable(&mut self, identifier: Target<'a>) {
        let node = Node::from(identifier);
        let Some(variable) = find_variable(identifier) else {
            self.references.push(ExpressionReference::Unknown { node });
            return;
        };
        if !self.already_checked.variables.insert(variable) {
            return;
        }
        let file = node.file();
        let is_eslint_used = match variable {
            Variable::Declared(symbol) => symbol.is_marked_used(),
            Variable::Global(name) => file.global_named(name).is_some_and(|it| it.is_exported),
        };
        if is_eslint_used {
            self.references.push(ExpressionReference::Exported { node });
        }
        let len = self.read_references.len();
        match variable {
            Variable::Declared(symbol) => {
                let references = symbol.references().rev();
                self.read_references
                    .extend(references.filter(|it| it.is_read()));
            }
            Variable::Global(name) => {
                let references = file.unresolved_references_to(name.bytes()).rev();
                let resolved = references.filter(|it| it.is_read() && it.global().is_some());
                self.read_references.extend(resolved);
            }
        }
        if self.read_references.len() == len {
            self.references.push(ExpressionReference::Unused { node });
        }
    }

    /// The loop of upstream's `iterateReferencesForVariable`, for each variable that was come to.
    fn iterate_read_references(mut self) -> Vec<ExpressionReference<'a>> {
        while let Some(reference) = self.read_references.pop() {
            match reference.node() {
                // A `JSXIdentifier`.
                Node::Expr(identifier) if identifier.is_jsx_tag_name() => {}
                Node::Expr(identifier) => self.iterate_references_for_expression(identifier),
                node @ Node::ExportSpec(_) => {
                    self.references.push(ExpressionReference::Exported { node });
                }
                // A name in a type, or that of a declaration which JSX uses.
                node => self.references.push(ExpressionReference::Unknown { node }),
            }
        }
        self.references
    }

    /// upstream's `iterateReferencesForFunctionArgument`
    fn iterate_references_for_function_argument(
        &mut self,
        expression: Expr<'a>,
        func: Func<'a>,
        arg_index: usize,
    ) {
        let functions = &mut self.already_checked.functions;
        let checked = functions.entry(func).or_insert_with(|| CheckedFunction {
            already_indexes: FxHashSet::default(),
            rest_index: func.params_with_this().position(Param::is_rest),
        });
        if !checked.already_indexes.insert(arg_index) {
            // cannot check
            return;
        }
        let has_rest = checked.rest_index.is_some_and(|it| it <= arg_index);
        // `this` is the first of `params`.
        let arg_node = match func.this_param() {
            Some(this) if arg_index == 0 => Some(this),
            Some(_) => func.params().get(arg_index - 1),
            None => func.params().get(arg_index),
        };
        match arg_node {
            // A `TSParameterProperty` is none of the patterns that upstream knows.
            Some(param) if !has_rest && !param.is_parameter_property() => {
                self.iterate_references_for_es_pattern(expression, param.pat().into());
            }
            _ => self.references.push(ExpressionReference::Unknown {
                node: expression.into(),
            }),
        }
    }
}

/// upstream's `isUsedInTest`
fn is_used_in_test<'a>(parent: Node<'a>, node: Expr<'a>) -> bool {
    match parent {
        Node::Stmt(parent) => matches!(parent.kind(), StmtKind::If { test, .. } if test == node),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Cond { test, .. } => test == node,
            ExprKind::Binary {
                op: BinOp::And,
                left,
                ..
            } => left == node,
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => operand == node,
            _ => false,
        },
        _ => false,
    }
}

/// upstream's `UsageOfPattern`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum UsageOfPattern {
    /// The pattern was only used via `.source`.
    Partial,
    /// The pattern was (probably) used the whole pattern as a regular expression.
    Whole,
    /// The pattern was used partial and whole.
    Mixed,
    /// The pattern cannot determine how was used.
    Unknown,
}

/// upstream's `getUsageOfPattern`
pub(crate) fn get_usage_of_pattern(node: Expr<'_>) -> UsageOfPattern {
    let usages = iterate_usage_of_pattern(node);
    if usages.contains(&UsageOfPattern::Unknown) {
        return UsageOfPattern::Unknown;
    }
    let has_whole = usages.contains(&UsageOfPattern::Whole);
    match (usages.contains(&UsageOfPattern::Partial), has_whole) {
        (true, true) => UsageOfPattern::Mixed,
        (true, false) => UsageOfPattern::Partial,
        (false, true) => UsageOfPattern::Whole,
        (false, false) => UsageOfPattern::Unknown,
    }
}

/// upstream's `iterateUsageOfPattern`
fn iterate_usage_of_pattern(node: Expr<'_>) -> Vec<UsageOfPattern> {
    let mut usages = Vec::new();
    for reference in extract_expression_references(node) {
        match reference {
            ExpressionReference::Member {
                member_expression, ..
            } => usages.extend(iterate_usage_of_pattern_for_member_expression(
                member_expression,
            )),
            ExpressionReference::Destructuring { pattern, .. } => {
                if matches!(pattern.kind(), TargetKind::Object) {
                    iterate_usage_of_pattern_for_object_pattern(pattern, &mut usages);
                }
            }
            ExpressionReference::Unused { .. } => {}
            ExpressionReference::Argument {
                node,
                call_expression,
            } => usages.push(match call_expression.as_call() {
                // A `ChainExpression` is around the callee of `(a?.b)(c)`.
                Some(call)
                    if call.args().first() == Some(node)
                        && ast_utils::is_member_expression(call.callee())
                        && !call.callee().is_chain_root() =>
                {
                    match prop_name_of_member_expression(call.callee()).as_deref() {
                        Some(
                            b"match" | b"matchAll" | b"split" | b"replace" | b"replaceAll"
                            | b"search",
                        ) => UsageOfPattern::Whole,
                        _ => UsageOfPattern::Unknown,
                    }
                }
                _ => UsageOfPattern::Unknown,
            }),
            _ => usages.push(UsageOfPattern::Unknown),
        }
    }
    usages
}

/// `!node.computed ? node.property.name : getStringIfConstant(context, node.property)`
fn prop_name_of_member_expression<'a>(node: Expr<'a>) -> Option<Cow<'a, [u8]>> {
    match node.kind() {
        // The `name` of a `PrivateIdentifier` is without the `#`.
        ExprKind::Dot { name, .. } => {
            let name = name.bytes();
            Some(Cow::Borrowed(name.strip_prefix(b"#").unwrap_or(name)))
        }
        ExprKind::Index { index, .. } => get_string_if_constant(index),
        _ => None,
    }
}

/// upstream's `iterateUsageOfPatternForMemberExpression`
fn iterate_usage_of_pattern_for_member_expression(node: Expr<'_>) -> Option<UsageOfPattern> {
    iterate_usage_of_pattern_for_prop_name(prop_name_of_member_expression(node).as_deref())
}

/// upstream's `iterateUsageOfPatternForPropName`
fn iterate_usage_of_pattern_for_prop_name(prop_name: Option<&[u8]>) -> Option<UsageOfPattern> {
    match prop_name {
        Some(b"source") => Some(UsageOfPattern::Partial),
        // Probably haven't used a regular expression yet.
        Some(
            b"compile" | b"dotAll" | b"flags" | b"global" | b"ignoreCase" | b"multiline"
            | b"sticky" | b"unicode",
        ) => None,
        // It's probably `exec`, `test`, or `lastIndex`, but it's considered to have been used as
        // a regular expression in other cases as well.
        _ => Some(UsageOfPattern::Whole),
    }
}

/// upstream's `iterateUsageOfPatternForObjectPattern`
fn iterate_usage_of_pattern_for_object_pattern(node: Target<'_>, usages: &mut Vec<UsageOfPattern>) {
    for prop in node.elements() {
        if prop.is_rest {
            continue;
        }
        let prop_name = prop.key.and_then(|key| match key.kind() {
            KeyKind::Computed(key) => get_string_if_constant(key),
            _ => key.name().map(|name| Cow::Borrowed(name.bytes())),
        });
        usages.extend(iterate_usage_of_pattern_for_prop_name(prop_name.as_deref()));
    }
}
