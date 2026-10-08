use super::decorators::FormatDecorators;
use super::function::{FormatCommentsBehindParenthesis, FormatFunctionBody, should_group_function_parameters};
use super::parameters::FormatFormalParameters;
use super::program::FormatStatements;
use super::semicolon::OptionalSemicolon;
use super::type_parameters::{FormatTSTypeParametersOptions, type_arguments, type_parameters};
use crate::js::format::{
    FormatMemberBeforeAnother, FormatTypeAnnotation, format_node, format_node_without_comments, identifier,
    no_comment_trails_what_is_before_another, write_trailing_comments_of,
};
use crate::js::parentheses::expression::needs_parentheses;
use crate::js::utils::assignment_like::AssignmentLike;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::object::{format_computed_or_property_key, key_requires_quotes};
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::prelude::*;
use crate::{format_args, write};

fn has_modifier(member: Member<'_>, flag: Flags) -> bool {
    member.modifiers().iter().any(|it| it.flag() == flag)
}

/// The `{ .. }` of a class that has members.
fn write_class_body<'a>(class: Class<'a>, f: &mut Formatter<'a>) {
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = class.members().iter().any(|member| {
            matches!(member.kind(), MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter)
                && member.key().is_some_and(|key| key_requires_quotes(key, member.as_ast_nodes(), f))
        });
        f.context_mut().push_quote_needed(quote_needed);
    }

    let members = format_with(|f| {
        let mut join = f.join_nodes_with_hardline();
        let mut iter = class.members().iter().peekable();
        while let Some(element) = iter.next() {
            join.entry(
                element.span(),
                &FormatClassElementWithSemicolon {
                    element,
                    next_element: iter.peek().copied(),
                },
            );
        }
    });
    write!(f, ["{", block_indent(&members), "}"]);

    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// A member of a class, an interface or a type literal.
pub(crate) fn write_member<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    match member.as_ast_nodes() {
        AstNodes::MethodDefinition(_) => write_method_definition(member, f),
        AstNodes::PropertyDefinition(_) => AssignmentLike::PropertyDefinition(member).fmt(f),
        AstNodes::AccessorProperty(_) => AssignmentLike::AccessorProperty(member).fmt(f),
        AstNodes::StaticBlock(_) => write_static_block(member, f),
        AstNodes::TSIndexSignature(_) => write_ts_index_signature(member, f),
        _ => super::ts_types::write_ts_signature(member, f),
    }
}

fn write_method_definition<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    let Some(value) = member.func() else {
        return;
    };
    write!(f, FormatDecorators::of_member(member));
    for (flag, keyword) in [
        (Flags::PUBLIC, "public"),
        (Flags::PROTECTED, "protected"),
        (Flags::PRIVATE, "private"),
        (Flags::STATIC, "static"),
        (Flags::ABSTRACT, "abstract"),
        (Flags::OVERRIDE, "override"),
    ] {
        if has_modifier(member, flag) {
            write!(f, [keyword, space()]);
        }
    }
    match member.kind() {
        MemberKind::Getter => write!(f, ["get", space()]),
        MemberKind::Setter => write!(f, ["set", space()]),
        _ => {}
    }
    write!(f, [value.is_async().then_some("async "), value.is_generator().then_some("*")]);
    let node = AstNodes::MethodDefinition(member);
    match (member.key(), member.constructor_keyword()) {
        (_, Some(keyword)) => write_constructor_keyword(keyword, node, f),
        (Some(key), None) => format_computed_or_property_key(key, node, f),
        (None, None) => {}
    }
    write!(f, member.flags().contains(Flags::OPTIONAL).then_some("?"));

    format_grouped_parameters_with_return_type_for_method(value, f);

    if value.has_body() {
        write!(f, FormatFunctionBody(value));
    } else {
        write!(f, OptionalSemicolon);
    }
}

/// `constructor`, which can be written as a string, and is quoted like any other name.
fn write_constructor_keyword<'a>(keyword: Ident<'a>, node: AstNodes<'a>, f: &mut Formatter<'a>) {
    let span = keyword.span();
    let source = f.source_text().text_for(&span);
    if source.starts_with(b"\"") || source.starts_with(b"'") {
        let is_unquoted = match f.options().quote_properties {
            QuoteProperties::AsNeeded => true,
            QuoteProperties::Preserve => false,
            QuoteProperties::Consistent => !f.context().is_quote_needed(),
        };
        format_node(span, || node, f, |f| match is_unquoted {
            true => write!(f, source_text(span.shrink(1, 1))),
            false => write!(f, FormatLiteralStringToken::new(source, false, StringLiteralParentKind::Expression)),
        });
    } else if f.context().is_quote_needed() {
        let quote = f.options().quote_style.as_str();
        format_node(span, || node, f, |f| write!(f, [quote, source_text(span), quote]));
    } else {
        write!(f, identifier(keyword, node));
    }
}

/// `static { .. }`
fn write_static_block<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    write!(f, ["static", space(), "{"]);
    match member.func().and_then(Func::body_statements).filter(|body| !body.is_empty()) {
        Some(body) => write!(f, block_indent(&FormatStatements(body))),
        None => write!(f, format_dangling_comments(member.span()).with_block_indent()),
    }
    write!(f, "}");
}

/// `[key: string]: T`
fn write_ts_index_signature<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    let Some(signature) = member.func() else {
        return;
    };
    let node = AstNodes::TSIndexSignature(member);
    for (flag, keyword) in [(Flags::STATIC, "static"), (Flags::READONLY, "readonly")] {
        if has_modifier(member, flag) {
            write!(f, [keyword, space()]);
        }
    }
    // With one parameter it is more like a computed name than a list: no trailing comma.
    let trailing_separator = match signature.params().len() > 1 {
        true => FormatTrailingCommas::ES5.trailing_separator(f.options()),
        false => TrailingSeparator::Disallowed,
    };
    let parameters = format_with(|f| {
        f.join_with(soft_line_break_or_space()).entries_with_trailing_separator(
            signature.params().iter().map(FormatIndexSignatureName),
            ",",
            trailing_separator,
        );
    });
    let is_class = matches!(node.parent(), AstNodes::ClassBody(_));
    write!(
        f,
        [
            "[",
            group(&soft_block_indent(&parameters)),
            "]",
            signature.return_type().map(FormatTypeAnnotation),
            is_class.then_some(OptionalSemicolon)
        ]
    );
}

/// The `key: string` of an index signature.
struct FormatIndexSignatureName<'a>(Param<'a>);

impl Spanned for FormatIndexSignatureName<'_> {
    fn span(&self) -> Span {
        self.0.span()
    }
}

impl<'a> Format<'a> for FormatIndexSignatureName<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let param = self.0;
        format_node(param.span(), || param.as_ast_nodes().parent(), f, |f| {
            write!(
                f,
                [
                    param.is_rest().then_some("..."),
                    source_text(param.pat().span()),
                    param.is_optional().then_some("?"),
                    param.ty().map(FormatTypeAnnotation)
                ]
            );
        });
    }
}

/// The types after `implements`, or after the `extends` of an interface.
pub(crate) struct FormatClassImplements<'a>(pub(crate) List<'a, TypeNode<'a>>);

impl<'a> Format<'a> for FormatClassImplements<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let last_index = self.0.len().saturating_sub(1);
        let mut joiner = f.join_with(soft_line_break_or_space());
        for (i, heritage) in
            FormatSeparatedIter::new(self.0.iter(), ",").with_trailing_separator(TrailingSeparator::Disallowed).enumerate()
        {
            // The comments after the last are written in the body.
            match i == last_index {
                true => joiner.entry(&FormatNodeWithoutTrailingComments(&heritage)),
                false => joiner.entry(&heritage),
            };
        }
    }
}

/// A class declaration or expression.
pub(crate) fn write_class<'a>(class: Class<'a>, f: &mut Formatter<'a>) {
    match class.owner() {
        Node::Expr(e) if class.decorators().next().is_some() && needs_parentheses(e, f) => {
            write!(f, soft_block_indent(&FormatClass(class)));
        }
        _ => FormatClass(class).fmt(f),
    }
}

struct FormatClass<'a>(Class<'a>);

impl<'a> Format<'a> for FormatClass<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let class = self.0;
        let node = AstNodes::Class(class);
        let parent = node.parent();
        let is_expression = matches!(class.owner(), Node::Expr(_));
        let super_class = class.extends();
        let implements = class.implements();
        let body_span = class.body_span();

        // Those of an exported class are written with the `export`, which they can be before.
        if is_expression || !matches!(parent, AstNodes::ExportNamedDeclaration(_) | AstNodes::ExportDefaultDeclaration(_))
        {
            write!(f, FormatDecorators::new(class.decorators(), node));
        }
        for (flag, keyword) in [(Flags::AMBIENT, "declare"), (Flags::ABSTRACT, "abstract")] {
            if class.modifiers().iter().any(|it| it.flag() == flag) {
                write!(f, [keyword, space()]);
            }
        }
        write!(f, "class");

        let gaps = HeadGaps::new(class);
        let head = format_with(|f| {
            if let Some(id) = class.name() {
                write!(f, [space(), FormatNodeWithoutTrailingComments(&identifier(id, node))]);
                write!(f, indent(&FormatCommentsTrailingInHead(gaps.after_name)));
            }
            if let Some(span) = class.type_params().angle_brackets_span() {
                let group_id = Some(f.group_id("type_parameters"));
                let options = FormatTSTypeParametersOptions {
                    group_id,
                    is_type_or_interface_decl: false,
                };
                write!(f, format_leading_comments(span));
                type_parameters(class.type_params(), Node::Class(class)).with_options(options).write_without_comments(f);
                write!(f, indent(&FormatCommentsTrailingInHead(gaps.after_type_parameters)));
            }
        });

        let group_mode = should_group(class, parent, &gaps, f);

        let format_heritage_clauses = format_with(|f| {
            if let Some(extends) = super_class {
                let format_super = format_with(|f| {
                    write!(f, format_leading_comments(extends.span()));
                    let content = FormatNodeWithoutTrailingComments(&extends);

                    // Prettier's `printSuperClass`.
                    if matches!(parent, AstNodes::AssignmentExpression(_)) {
                        let content = content.memoized();
                        write!(
                            f,
                            group(&format_args!(
                                if_group_breaks(&format_args!("(", soft_block_indent(&content), ")")),
                                if_group_fits_on_line(&content)
                            ))
                        );
                    } else {
                        content.fmt(f);
                    }
                    write!(f, FormatCommentsTrailingInHead(gaps.after_super_class));
                    if let Some(span) = class.extends_args().angle_brackets_span() {
                        write!(f, format_leading_comments(span));
                        type_arguments(class.extends_args(), Node::Class(class)).write_without_comments(f);
                        write!(f, FormatCommentsTrailingInHead(gaps.after_super_type_arguments));
                    }
                });

                let format_extends = format_args!("extends", space(), format_super);
                match group_mode {
                    true => write!(f, [soft_line_break_or_space(), group(&format_extends)]),
                    false => write!(f, [space(), format_extends]),
                }
            }

            if let Some(first) = implements.first() {
                // Those on a line with code, after the `implements`, lead the first type.
                let comments = f.comments().comments_before(first.span().start);
                let count = comments.iter().take_while(|it| it.preceded_by_newline() || it.followed_by_newline()).count();
                let leading_comments = comments.get(..count).unwrap_or_default();
                let implements = FormatClassImplements(implements);

                if usize::from(super_class.is_some()) + implements.0.len() > 1 {
                    write!(
                        f,
                        [
                            soft_line_break_or_space(),
                            FormatLeadingComments::Comments(leading_comments),
                            (!leading_comments.is_empty()).then_some(hard_line_break()),
                            "implements",
                            group(&soft_line_indent_or_space(&implements))
                        ]
                    );
                } else {
                    let format_comments = FormatDanglingComments::Comments {
                        comments: leading_comments,
                        indent: DanglingIndentMode::None,
                    };
                    let needs_line_break = leading_comments.last().is_some_and(|it| it.is_line());
                    let format_inner = format_args!(
                        "implements",
                        space(),
                        format_comments,
                        needs_line_break.then_some(hard_line_break()),
                        implements
                    );
                    match group_mode {
                        true => write!(f, [soft_line_break_or_space(), group(&format_inner)]),
                        false => write!(f, [space(), format_inner]),
                    }
                }
            }
        });

        if group_mode {
            let heritage_id = f.group_id("heritageGroup");
            write!(f, group(&format_args!(head, indent(&format_heritage_clauses))).with_group_id(Some(heritage_id)));
            // The `{` on a line of its own sets the members apart from a head that is broken.
            if class.members().is_empty() {
                write!(f, space());
            } else {
                write!(
                    f,
                    [
                        if_group_breaks(&hard_line_break()).with_group_id(Some(heritage_id)),
                        if_group_fits_on_line(&space()).with_group_id(Some(heritage_id))
                    ]
                );
            }
        } else {
            write!(f, [head, format_heritage_clauses, space()]);
        }

        // Prettier's `handleClassComments`: a comment before the `{` that starts or ends its line is
        // moved into the body.
        let comments = f.comments().comments_before(body_span.start);
        let count = comments.iter().take_while(|it| !it.preceded_by_newline() && !it.followed_by_newline()).count();
        write!(f, FormatLeadingComments::Comments(comments.get(..count).unwrap_or_default()));

        if class.members().is_empty() {
            write!(f, ["{", format_dangling_comments(node.span()).with_block_indent(), "}"]);
        } else {
            format_node_without_comments(body_span, || node, f, |f| write_class_body(class, f));
        }
    }
}

/// What follows a part of the head of a class.
#[derive(Copy, Clone)]
enum HeadGap {
    /// The `<` of type parameters or type arguments.
    AngleBracket,
    /// `extends` and the super class.
    Extends {
        /// It is an optional chain, which Prettier attaches no comments to. So what follows the
        /// comment is not the super class, and `handleClassComments` has nothing to say.
        is_chain: bool,
    },
    /// `implements` and the first type.
    Implements {
        /// What is before it is the name, the type parameters or the super class, as opposed to its
        /// type arguments or what is in an optional chain.
        follows_known_part: bool,
    },
}

/// Between two parts of the head of a class: where the first ends, where the second starts, and
/// what the second is. `None` if the `{` is next.
type HeadGapAt = Option<(u32, u32, HeadGap)>;

struct HeadGaps {
    after_name: HeadGapAt,
    after_type_parameters: HeadGapAt,
    after_super_class: HeadGapAt,
    after_super_type_arguments: HeadGapAt,
}

impl HeadGaps {
    fn new(class: Class<'_>) -> Self {
        let implements = |follows_known_part| {
            class.implements().first().map(|it| {
                (
                    it.span().start,
                    HeadGap::Implements {
                        follows_known_part,
                    },
                )
            })
        };
        let is_chain = class.extends().is_some_and(is_chain_root);
        let heritage =
            || class.extends().map(|it| (it.span().start, HeadGap::Extends { is_chain })).or_else(|| implements(true));
        let angle_bracket = |span: Option<Span>| span.map(|it| (it.start, HeadGap::AngleBracket));
        let type_parameters = class.type_params().angle_brackets_span();
        let type_arguments = class.extends_args().angle_brackets_span();
        let gap = |end: Option<u32>, next: Option<(u32, HeadGap)>| Some((end?, next?.0, next?.1));
        HeadGaps {
            after_name: gap(class.name().map(|it| it.span().end), angle_bracket(type_parameters).or_else(heritage)),
            after_type_parameters: gap(type_parameters.map(|it| it.end), heritage()),
            after_super_class: gap(
                class.extends().map(|it| it.outer_span().end),
                angle_bracket(type_arguments).or_else(|| implements(!is_chain)),
            ),
            after_super_type_arguments: gap(type_arguments.map(|it| it.end), implements(false)),
        }
    }
}

/// How many of `comments`, which are in `gap`, trail what is before them. The others lead what
/// follows. Prettier's `handleClassComments`, and what it does with any comment.
fn count_comments_trailing_in_head(comments: &[Comment], gap: HeadGap, next_start: u32, f: &Formatter<'_>) -> usize {
    let is_before = |comment: &Comment, keyword: &[u8]| {
        bun_core::strings::contains(f.source_text().slice_range(comment.end(), next_start), keyword)
    };
    (comments.iter())
        .take_while(|comment| {
            let starts_or_ends_line = comment.preceded_by_newline() || comment.followed_by_newline();
            match gap {
                HeadGap::AngleBracket => !comment.preceded_by_newline() && comment.followed_by_newline(),
                HeadGap::Extends { is_chain } => match starts_or_ends_line {
                    true => !is_chain || !comment.preceded_by_newline(),
                    false => is_before(comment, b"extends"),
                },
                HeadGap::Implements {
                    follows_known_part,
                } => match starts_or_ends_line {
                    true => follows_known_part,
                    false => is_before(comment, b"implements"),
                },
            }
        })
        .count()
}

/// The comments in a gap that trail what is before them.
struct FormatCommentsTrailingInHead(HeadGapAt);

impl<'a> Format<'a> for FormatCommentsTrailingInHead {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if !f.is_quiet()
            && let Some((_, next_start, gap)) = self.0
        {
            let comments = f.comments().comments_before(next_start);
            let count = count_comments_trailing_in_head(comments, gap, next_start, f);
            write!(f, FormatTrailingComments::Comments(comments.get(..count).unwrap_or_default()));
        }
    }
}

/// Prettier's `shouldPrintClassInGroupMode`: whether the head of the class is a group that can break
/// before `extends` and `implements`.
fn should_group<'a>(class: Class<'a>, parent: AstNodes<'a>, gaps: &HeadGaps, f: &Formatter<'a>) -> bool {
    let (super_class, implements) = (class.extends(), class.implements());
    if usize::from(super_class.is_some()) + implements.len() > 1 {
        return true;
    }

    // Prettier's `isMemberExpression(stripChainElementWrappers(e))`.
    let is_member = |mut e: Expr<'a>| {
        while let ExprKind::NonNull(inner) = e.kind() {
            e = inner;
        }
        matches!(e.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. })
    };
    let is_member_heritage = match (super_class, implements.first()) {
        (Some(super_class), _) => {
            !matches!(parent, AstNodes::AssignmentExpression(_)) && class.extends_args().is_empty() && is_member(super_class)
        }
        (None, Some(first)) => match first.kind() {
            TypeKind::Heritage { expr, args } => args.is_empty() && is_member(expr),
            TypeKind::Ref { name, args } => args.is_empty() && name.len() > 1,
            _ => false,
        },
        (None, None) => false,
    };
    if is_member_heritage || f.is_quiet() {
        return is_member_heritage;
    }

    // A comment trails the name or the type parameters, or is around the super class.
    let counts = |gap: HeadGapAt| {
        gap.map_or((0, 0), |(end, next_start, gap)| {
            let comments = f.comments().comments_in_range(end, next_start);
            (comments.len(), count_comments_trailing_in_head(comments, gap, next_start, f))
        })
    };
    let before_super_class = match (gaps.after_type_parameters, gaps.after_name, super_class) {
        (Some(gap), ..) | (None, Some(gap), _) if matches!(gap.2, HeadGap::Extends { .. }) => {
            let (all, trailing) = counts(Some(gap));
            all - trailing
        }
        (None, None, Some(super_class)) => f.comments().comments_before(super_class.span().start).len(),
        _ => 0,
    };
    counts(gaps.after_name).1 > 0
        || counts(gaps.after_type_parameters).1 > 0
        || before_super_class > 0
        || counts(gaps.after_super_class).1 > 0
}

/// A member of a class and the `;` after it.
struct FormatClassElementWithSemicolon<'a> {
    element: Member<'a>,
    next_element: Option<Member<'a>>,
}

impl FormatClassElementWithSemicolon<'_> {
    /// Prettier's `shouldPrintSemicolonAfterClassProperty`: with `semi: false`, whether the property
    /// `element` needs a `;` all the same.
    fn needs_semicolon(&self) -> bool {
        let element = self.element;
        // `static;`, `get;`, `set;`
        if element.init().is_none()
            && element.ty().is_none()
            && element.key().is_some_and(|key| {
                matches!(key.kind(), KeyKind::Ident(name) if matches!(name.bytes(), b"static" | b"get" | b"set"))
            })
        {
            return true;
        }
        let Some(next) = self.next_element else {
            return false;
        };
        if [Flags::STATIC, Flags::PUBLIC, Flags::PROTECTED, Flags::PRIVATE, Flags::READONLY]
            .into_iter()
            .any(|flag| has_modifier(next, flag))
        {
            return false;
        }

        // What follows would be taken for the rest of this property: `in`, `[a]`, `*a() {}`.
        let is_computed = next.key().is_some_and(Key::is_computed);
        if next.key().is_some_and(|key| {
            matches!(key.kind(), KeyKind::Ident(name) if matches!(name.bytes(), b"in" | b"instanceof"))
        }) {
            return true;
        }
        match next.as_ast_nodes() {
            AstNodes::PropertyDefinition(_) => is_computed,
            AstNodes::MethodDefinition(_) => next.func().is_some_and(|value| {
                !value.is_async()
                    && !matches!(next.kind(), MemberKind::Getter | MemberKind::Setter)
                    && (is_computed || value.is_generator())
            }),
            AstNodes::TSIndexSignature(_) => true,
            _ => false,
        }
    }
}

impl<'a> Format<'a> for FormatClassElementWithSemicolon<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let needs_semi = self.element.kind() == MemberKind::Property
            && match f.options().semicolons {
                Semicolons::Always => true,
                Semicolons::AsNeeded => self.needs_semicolon(),
            }
            && !f.comments().is_suppressed(self.element.span().start)
            && !f.comments().has_trailing_suppression_comment(self.element.span().end);

        if f.is_quiet() {
            return write!(f, [self.element, needs_semi.then_some(";")]);
        }
        if needs_semi {
            // The comments before the `;` are written behind it.
            let element = FormatPropertyWithoutSemicolon(self.element, f.comments().without_semicolon(self.element.span()));
            write!(f, [FormatNodeWithoutTrailingComments(&element), ";"]);
            if !(self.next_element.is_some() && no_comment_trails_what_is_before_another(f)) {
                write_trailing_comments_of(self.element.as_ast_nodes(), f);
            }
        } else if self.next_element.is_some() {
            write!(f, FormatMemberBeforeAnother(self.element));
        } else {
            write!(f, self.element);
        }
    }
}

/// A property, and its span without the `;`.
struct FormatPropertyWithoutSemicolon<'a>(Member<'a>, Span);

impl Spanned for FormatPropertyWithoutSemicolon<'_> {
    fn span(&self) -> Span {
        self.1
    }
}

impl<'a> Format<'a> for FormatPropertyWithoutSemicolon<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        self.0.fmt(f);
    }
}

/// Prettier's `printMethodValue`: the type parameters, the parameters and the return type of a
/// method.
pub(crate) fn format_grouped_parameters_with_return_type_for_method<'a>(func: Func<'a>, f: &mut Formatter<'a>) {
    write!(f, type_parameters(func.type_params(), Node::Func(func)));
    write!(f, FormatCommentsBehindParenthesis(func));

    group(&format_with(|f| {
        let format_parameters = FormatFormalParameters(func).memoized();
        let return_type = func.return_type().map(FormatTypeAnnotation);
        let format_return_type = return_type.as_ref().map(FormatNodeWithoutTrailingComments).memoized();

        // The parameters have to be formatted before the return type, which
        // `should_group_function_parameters` may do.
        format_parameters.inspect(f);

        let should_break_parameters = should_break_function_parameters(func);
        let should_group_parameters =
            should_break_parameters || should_group_function_parameters(func, &format_return_type, f);

        match should_group_parameters {
            true => write!(f, group(&format_parameters).should_expand(should_break_parameters)),
            false => write!(f, format_parameters),
        }
        write!(f, format_return_type);
    }))
    .fmt(f);
}

/// `constructor(public x: number, y: number) {}`: more than one parameter, one of which has a
/// modifier, are each on their own line.
fn should_break_function_parameters(func: Func<'_>) -> bool {
    func.params().len() > 1
        && func.params().iter().any(|param| param.modifiers().iter().any(|it| it.decorator().is_none()))
}
