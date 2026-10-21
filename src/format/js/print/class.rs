use super::decorators::FormatDecorators;
use super::function::{FormatFunctionBody, write_parameters_and_return_type};
use super::function_type::write_accessor_keyword;
use super::parameters::FormatFormalParameters;
use super::program::FormatStatements;
use super::semicolon::OptionalSemicolon;
use super::type_parameters::{FormatTSTypeParametersOptions, type_arguments, type_parameters};
use crate::js::attach::Marker;
use crate::js::format::{
    FormatTypeAnnotation, format_name, format_node, identifier,
    ignored_node_terminator_follows_semi, name_without_comments,
};
use crate::js::parentheses::expression::needs_parentheses;
use crate::js::utils::assignment_like::AssignmentLike;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::object::{format_computed_or_property_key, key_requires_quotes};
use crate::js::utils::statement_body::write_space_before_body;
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::typecast::{
    comments_of_expression, has_comments_that_count, is_chain_expression_without_comments,
};
use crate::prelude::*;
use crate::{format_args, write};

fn has_modifier(member: Member<'_>, flag: Flags) -> bool {
    member.modifiers().iter().any(|it| it.flag() == flag)
}

/// The `{ .. }` of a class. Prettier's `printClassBody`.
fn write_class_body<'a>(class: Class<'a>, f: &mut Formatter<'a>) {
    if class.members().is_empty() {
        let comments = dangling_comments(AstNodes::ClassBody(class)).with_block_indent();
        return write!(f, ["{", comments, "}"]);
    }
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = class.members().iter().any(|member| {
            matches!(
                member.kind(),
                MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
            ) && member
                .key()
                .is_some_and(|key| key_requires_quotes(key, member.as_ast_nodes(), f))
        });
        f.context_mut().push_quote_needed(quote_needed);
    }

    let members = format_with(|f| {
        let mut iter = class.members().iter().peekable();
        let mut is_first = true;
        while let Some(element) = iter.next() {
            match is_first {
                true => is_first = false,
                false if has_empty_line_before(element, f) => write!(f, empty_line()),
                false => write!(f, hard_line_break()),
            }
            let next_element = iter.peek().copied();
            write!(
                f,
                FormatClassElementWithSemicolon {
                    element,
                    next_element
                }
            );
        }
    });
    write!(f, ["{", block_indent(&members), "}"]);

    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// True if there's an empty line between `element` and the member before it.
fn has_empty_line_before<'a>(element: Member<'a>, f: &Formatter<'a>) -> bool {
    let span = element.span();
    // `a() {}⏎// comment⏎;⏎⏎b() {}`: the comment leads `b`, and the empty line is after the comment.
    let has_comments = !f.is_quiet() && f.comments().is_owner(Node::Member(element));
    let comment_before_stray_semicolon = match has_comments {
        true => (f.comments().of_node(element.as_ast_nodes()).leading.first())
            .filter(|comment| comment.next_token_start() != span.start),
        false => None,
    };
    if let Some(comment) = comment_before_stray_semicolon {
        return crate::text::is_previous_line_empty(
            f.source_text().as_bytes(),
            comment.span().start as usize,
        );
    }
    // `a = 1 ⏎ ⏎ ;[b] = 2`: the `;` ends the previous member, so this one follows it on the same line.
    let follows_semicolon =
        span.start != 0 && f.source_text().byte_at(span.start - 1) == Some(b';');
    !follows_semicolon && f.lines_before(span) > 1
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

/// True if the last modifier printed before `member`'s name must be on the same line as the name. With a line break
/// after it, it would be parsed as a member name. A line break is fine after `static`, `get`, `set` and `*`.
fn last_modifier_must_stay_on_name_line(member: Member<'_>) -> bool {
    let function = member.func();
    if matches!(member.kind(), MemberKind::Getter | MemberKind::Setter)
        || function.is_some_and(Func::is_generator)
    {
        return false;
    }
    if function.is_some_and(Func::is_async) {
        return true;
    }
    let modifier_flags =
        (member.modifiers().iter()).fold(Flags::empty(), |all, it| all | it.flag());
    // Checked from the last modifier printed to the first. `IN` and `OUT` are Flow's `+` and `-`.
    if modifier_flags.intersects(Flags::IN | Flags::OUT) {
        return false;
    }
    if modifier_flags
        .intersects(Flags::ABSTRACT | Flags::OVERRIDE | Flags::READONLY | Flags::ACCESSOR)
    {
        return true;
    }
    !modifier_flags.contains(Flags::STATIC)
        && modifier_flags
            .intersects(Flags::AMBIENT | Flags::PUBLIC | Flags::PROTECTED | Flags::PRIVATE)
}

/// In `static // comment⏎async a() {}` the modifiers aren't nodes, so the comment is attached to the name as a leading
/// comment. Prettier and oxfmt print `static async // comment⏎a() {}`, which declares a field `async` and a method that
/// is neither static nor async. This prints those comments before the first modifier instead. The code that prints the
/// name skips them because they're already marked as printed.
pub(crate) fn write_comments_between_modifiers<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return;
    }
    let Some(key) = member.key().filter(|key| !key.is_computed()) else {
        return;
    };
    let comments = f.comments().of_name(key.inner_span(f.file()).start).leading;
    if (comments.iter()).any(|comment| comment.has_newline_after() || comment.is_multiline_block())
        && last_modifier_must_stay_on_name_line(member)
    {
        write!(f, FormatLeadingComments::Comments(comments));
    }
}

fn write_method_definition<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    let Some(value) = member.func() else {
        return;
    };
    if !member.modifiers().is_empty() {
        write!(f, FormatDecorators::from_member(member));
        write_comments_between_modifiers(member, f);
        for (flag, keyword) in [
            (Flags::PUBLIC, "public "),
            (Flags::PROTECTED, "protected "),
            (Flags::PRIVATE, "private "),
            (Flags::STATIC, "static "),
            (Flags::ABSTRACT, "abstract "),
            (Flags::OVERRIDE, "override "),
        ] {
            // An error, and not in typescript-estree's tree.
            let is_dropped = flag == Flags::OVERRIDE
                && member.constructor_keyword().is_some()
                && !constructor_keeps_override(f);
            if has_modifier(member, flag) && !is_dropped {
                write!(f, keyword);
            }
        }
    }
    write_accessor_keyword(member.kind(), f);
    write!(
        f,
        [
            value.is_async().then_some("async "),
            value.is_generator().then_some("*")
        ]
    );
    let node = AstNodes::MethodDefinition(member);
    match (member.key(), member.constructor_keyword()) {
        (_, Some(keyword)) => write_constructor_keyword(keyword, f),
        (Some(key), None) => format_computed_or_property_key(key, node, f),
        (None, None) => {}
    }
    write!(f, member.flags().contains(Flags::OPTIONAL).then_some("?"));

    // `a(/* prettier-ignore */) {}`: typescript-estree has a `FunctionExpression` here, which is copied up to its end.
    let function = AstNodes::Function(value);
    if !f.is_quiet() && f.comments().is_ignored(function) {
        return format_node(function, f, |_| {});
    }
    format_grouped_parameters_with_return_type_for_method(value, f);

    if value.has_body() {
        return write!(f, FormatFunctionBody(value));
    }
    write!(f, OptionalSemicolon);
}

fn constructor_keeps_override(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `constructor`, which can be written as a string, and is quoted like any other name.
fn write_constructor_keyword<'a>(keyword: Ident<'a>, f: &mut Formatter<'a>) {
    let span = keyword.span();
    let source = f.source_text().text_for(&span);
    if source.starts_with(b"\"") || source.starts_with(b"'") {
        // Not `"\x63onstructor"`.
        let is_name = source.get(1..source.len().saturating_sub(1)) == Some(b"constructor");
        let is_unquoted = is_name
            && match f.options().quote_properties {
                QuoteProperties::AsNeeded => true,
                QuoteProperties::Preserve => false,
                QuoteProperties::Consistent => !f.context().is_quote_needed(),
            };
        format_name(span, f, |f| match is_unquoted {
            true => write!(f, source_text(span.shrink(1, 1))),
            false => write!(
                f,
                FormatLiteralStringToken::new(source, false, StringLiteralParentKind::Expression)
            ),
        });
    } else if f.context().is_quote_needed() {
        let quote = f.options().quote_style.as_str();
        format_name(span, f, |f| write!(f, [quote, source_text(span), quote]));
    } else {
        write!(f, identifier(keyword));
    }
}

/// `static { ; }` is `static {}` for Prettier. oxfmt breaks the line between the braces.
fn block_of_empty_statements_is_empty(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// `static { .. }`
fn write_static_block<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    write!(f, ["static", space(), "{"]);
    let is_empty = |body: &List<'a, Stmt<'a>>| match block_of_empty_statements_is_empty(f) {
        true => body.iter().all(|it| it.tag() == StmtTag::Empty),
        false => body.is_empty(),
    };
    match member
        .func()
        .and_then(Func::body_statements)
        .filter(|body| !is_empty(body))
    {
        // `static {⏎;⏎// comment⏎}` is `static {⏎}⏎// comment` for oxfmt.
        Some(body) if body.iter().all(|it| it.tag() == StmtTag::Empty) => {
            let comments = f.comments().of_node(AstNodes::StaticBlock(member)).dangling;
            return write!(
                f,
                [
                    hard_line_break(),
                    "}",
                    FormatTrailingComments::Comments(comments)
                ]
            );
        }
        Some(body) => write!(f, block_indent(&FormatStatements(body))),
        None => write!(
            f,
            dangling_comments(AstNodes::StaticBlock(member)).with_block_indent()
        ),
    }
    write!(f, "}");
}

/// `[key: string]: T`
fn write_ts_index_signature<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    if f.file().is_flow() {
        return super::flow::write_object_type_member(member, f);
    }
    let Some(signature) = member.func() else {
        return;
    };
    let node = AstNodes::TSIndexSignature(member);
    for (flag, keyword) in [(Flags::STATIC, "static"), (Flags::READONLY, "readonly")] {
        if has_modifier(member, flag) {
            write!(f, [keyword, space()]);
        }
    }
    // With one parameter it's more like a computed name than a list, so there's no trailing comma.
    let trailing_separator = match signature.params().len() > 1 {
        true => FormatTrailingCommas::ES5.trailing_separator(f.options()),
        false => TrailingSeparator::Disallowed,
    };
    let parameters = format_with(|f| {
        f.join_with(soft_line_break_or_space())
            .entries_with_trailing_separator(
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
        format_node(param.as_ast_nodes(), f, |f| {
            write!(
                f,
                [
                    param.is_rest().then_some("..."),
                    param.pat(),
                    param.is_optional().then_some("?"),
                    param.ty().map(FormatTypeAnnotation)
                ]
            );
            // An error.
            if let Some(default) = param.default() {
                write!(f, [space(), "=", space(), default]);
            }
        });
    }
}

/// `a = class extends (⏎ b.C<D> ⏎) {}`. For Prettier the parentheses are around `b.C`, and `<D>` comes after them.
fn super_class_type_arguments_are_in_parentheses(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// The types after `implements`, or after the `extends` of an interface.
pub(crate) struct FormatClassImplements<'a>(pub(crate) List<'a, TypeNode<'a>>);

impl<'a> Format<'a> for FormatClassImplements<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.join_with(soft_line_break_or_space())
            .entries_with_trailing_separator(self.0.iter(), ",", TrailingSeparator::Disallowed);
    }
}

/// Returns the dangling comments of `node` that have `marker`: Prettier's
/// `printDanglingComments(path, options, { marker })`.
pub(crate) fn dangling_comments_with_marker<'a>(
    node: AstNodes<'a>,
    marker: Marker,
    f: &Formatter<'a>,
) -> CommentList<'a> {
    let comments = f.comments().of_node(node).dangling;
    let has_marker = |comment: &Comment<'a>| {
        (f.comments().attachment(*comment)).is_some_and(|attachment| attachment.marker == marker)
    };
    let start = comments.iter().take_while(|it| !has_marker(it)).count();
    let count = comments.iter().skip(start).take_while(has_marker).count();
    comments.slice(start, start + count)
}

/// A class declaration or expression.
#[inline(never)]
pub(crate) fn write_class<'a>(class: Class<'a>, f: &mut Formatter<'a>) {
    match class.owner() {
        Node::Expr(e) if class.decorators().next().is_some() && needs_parentheses(e, f) => {
            match matches!(e.ast_parent(), AstNodes::ExportDefaultDeclaration(_))
                && decorators_in_export_start_a_line(f)
            {
                true => write!(
                    f,
                    [
                        indent(&format_args!(empty_line(), FormatClass(class))),
                        soft_line_break()
                    ]
                ),
                false => write!(f, soft_block_indent(&FormatClass(class))),
            }
        }
        _ => FormatClass(class).fmt(f),
    }
}

/// Prettier's `printDecorators` starts with a line break in an `export`, even right after the line break that follows
/// the parenthesis of `export default (@a class {})`.
fn decorators_in_export_start_a_line(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

struct FormatClass<'a>(Class<'a>);

impl<'a> Format<'a> for FormatClass<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let class = self.0;
        if class.file().is_flow() && super::flow::write_class(class, f) {
            return;
        }
        let node = AstNodes::Class(class);
        let parent = node.parent();
        let is_expression = matches!(class.owner(), Node::Expr(_));
        let super_class = class.extends();
        let implements = class.implements();

        // An exported class's decorators are written with the `export`, because they can come before it.
        if is_expression
            || !matches!(
                parent,
                AstNodes::ExportNamedDeclaration(_) | AstNodes::ExportDefaultDeclaration(_)
            )
        {
            write!(f, FormatDecorators::new(class.decorators(), node));
        }
        for (flag, keyword) in [(Flags::AMBIENT, "declare"), (Flags::ABSTRACT, "abstract")] {
            if class.modifiers().iter().any(|it| it.flag() == flag) {
                write!(f, [keyword, space()]);
            }
        }
        write!(f, "class");

        // The trailing comments of the name and of the type parameters are indented.
        let head = format_with(|f| {
            if let Some(id) = class.name() {
                let comments = f.comments().of_name(id.span().start);
                write!(
                    f,
                    [
                        space(),
                        FormatLeadingComments::Comments(comments.leading),
                        name_without_comments(id.span()),
                        indent(&FormatTrailingComments::Comments(comments.trailing))
                    ]
                );
            }
            if !class.type_params().is_empty() {
                let options = FormatTSTypeParametersOptions {
                    group_id: Some(f.group_id("type_parameters")),
                    is_type_or_interface_decl: false,
                };
                let type_parameters =
                    type_parameters(class.type_params(), Node::Class(class)).with_options(options);
                write!(
                    f,
                    [
                        FormatNodeWithoutTrailingComments(&type_parameters),
                        indent(&trailing_comments(AstNodes::TSTypeParameterDeclaration(
                            Node::Class(class)
                        )))
                    ]
                );
            }
        });

        let group_mode = should_group(class, parent, f);

        let format_heritage_clauses = format_with(|f| {
            if let Some(extends) = super_class {
                let format_extends =
                    format_args!("extends", space(), FormatSuperClass { class, extends });
                match group_mode {
                    true => write!(f, [soft_line_break_or_space(), group(&format_extends)]),
                    false => write!(f, [space(), format_extends]),
                }
            }

            // Prettier's `printHeritageClauses`
            if !implements.is_empty() {
                let comments = match f.is_quiet() {
                    true => CommentList::empty(),
                    false => dangling_comments_with_marker(node, Marker::Implements, f),
                };
                let format_comments = FormatDanglingComments::Comments {
                    comments,
                    indent: DanglingIndentMode::None,
                };
                let implements = FormatClassImplements(implements);

                if has_multiple_heritage(class) {
                    write!(
                        f,
                        [
                            soft_line_break_or_space(),
                            format_with(|f| match keeps_empty_lines_before_implements(f) {
                                true => write_comments_with_empty_lines(comments, f),
                                false => write!(
                                    f,
                                    [
                                        format_comments,
                                        (!comments.is_empty()).then_some(hard_line_break())
                                    ]
                                ),
                            }),
                            "implements",
                            group(&soft_line_indent_or_space(&implements))
                        ]
                    );
                } else {
                    // `class // comment⏎implements A {}`: Prettier 3.9.9 prints `class implements // commentA {}`.
                    let are_before_keyword = comments_are_before_implements(f)
                        || comments.iter().any(|comment| comment.is_line());
                    let format_inner = format_with(|f| match comments.last() {
                        Some(last) if are_before_keyword => {
                            write!(f, format_comments);
                            match last.is_line() || last.has_newline_after() {
                                true => write!(f, hard_line_break()),
                                false => write!(f, space()),
                            }
                            write!(f, ["implements", space(), implements]);
                        }
                        _ => write!(f, ["implements", space(), format_comments, implements]),
                    });
                    match group_mode {
                        true => write!(f, [soft_line_break_or_space(), group(&format_inner)]),
                        false => write!(f, [space(), format_inner]),
                    }
                }
            }
        });

        if group_mode {
            let heritage_id = f.group_id("heritageGroup");
            write!(
                f,
                group(&format_args!(head, indent(&format_heritage_clauses)))
                    .with_group_id(Some(heritage_id))
            );
            // Putting the `{` on its own line separates the members from a broken head.
            if !class.members().is_empty() {
                write!(
                    f,
                    if_group_breaks(&hard_line_break()).with_group_id(Some(heritage_id))
                );
            }
        } else {
            write!(f, [head, format_heritage_clauses]);
        }

        write_space_before_body(AstNodes::ClassBody(class), f);
        format_node(AstNodes::ClassBody(class), f, |f| {
            write_class_body(class, f)
        });
    }
}

/// `class A extends B /* comment */⏎<C> {}` is `B<C> /* comment */` for Prettier and `B /* comment */<C>` for oxfmt.
fn super_class_comments_wrap_type_arguments(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// The part after `extends`: the super class with its type arguments. The super class's comments go around both.
struct FormatSuperClass<'a> {
    class: Class<'a>,
    extends: Expr<'a>,
}

impl<'a> Format<'a> for FormatSuperClass<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let FormatSuperClass { class, extends } = *self;
        // A JSX element writes its own comments, and so does the content of a `ChainExpression`.
        let comments = (!f.is_quiet()
            && super_class_comments_wrap_type_arguments(f)
            && extends.tag() != ExprTag::Jsx
            && !is_chain_expression_without_comments(extends, f))
        .then(|| comments_of_expression(extends, f));
        let type_arguments = type_arguments(class.extends_args(), Node::Class(class));
        let are_type_arguments_in_parentheses = super_class_type_arguments_are_in_parentheses(f);
        let content = format_with(|f| {
            match comments {
                Some(_) => write!(f, FormatNodeWithoutTrailingComments(&extends)),
                None => write!(f, extends),
            }
            if are_type_arguments_in_parentheses {
                write!(f, type_arguments);
            }
        });

        // They're written here, so `extends` doesn't write them again.
        if let Some(comments) = comments {
            // `extends a⏎// prettier-ignore⏎.b`: the comment leads `a.b`, and is copied with it.
            let is_copied = |comment: &Comment<'a>| {
                comments.is_ignored && comment.span().start >= extends.span().start
            };
            let count = (comments.leading.iter())
                .take_while(|it| !is_copied(it))
                .count();
            let leading_comments = comments.leading.slice(0, count);
            write!(f, FormatLeadingComments::Comments(leading_comments));
        }
        // Prettier's `printSuperClass`.
        if matches!(
            AstNodes::Class(class).parent(),
            AstNodes::AssignmentExpression(_)
        ) {
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
        if !are_type_arguments_in_parentheses {
            write!(f, type_arguments);
        }
        if let Some(comments) = comments {
            write!(f, FormatTrailingComments::Comments(comments.trailing));
        }
    }
}

/// Prettier's `hasMultipleHeritage`.
fn has_multiple_heritage(class: Class<'_>) -> bool {
    usize::from(class.extends().is_some()) + class.implements().len() > 1
}

/// `class /* comment */ implements A {}` is `class implements /* comment */ A {}` for Prettier.
fn comments_are_before_implements(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `class A extends B⏎// comment⏎⏎implements C {}`: oxfmt keeps the empty line after the comment.
fn keeps_empty_lines_before_implements(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Writes each of `comments` on its own line, keeping the empty lines after them.
fn write_comments_with_empty_lines<'a>(comments: CommentList<'a>, f: &mut Formatter<'a>) {
    for index in 0..comments.len() {
        let comments = comments.slice(index, index + 1);
        let is_next_line_empty = (comments.first())
            .is_some_and(|comment| f.source_text().lines_after(comment.span().end) > 1);
        let indent = DanglingIndentMode::None;
        write!(f, FormatDanglingComments::Comments { comments, indent });
        match is_next_line_empty {
            true => write!(f, empty_line()),
            false => write!(f, hard_line_break()),
        }
    }
}

/// Prettier's `shouldPrintClassInGroupMode`: true if the class head is a group that can break before `extends` and
/// `implements`.
fn should_group<'a>(class: Class<'a>, parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    let (super_class, implements) = (class.extends(), class.implements());
    if has_multiple_heritage(class) {
        return true;
    }
    if !f.is_quiet() {
        let comments = f.comments();
        let type_parameters = AstNodes::TSTypeParameterDeclaration(Node::Class(class));
        if (class.name()).is_some_and(|id| !comments.of_name(id.span().start).trailing.is_empty())
            || !comments.of_node(type_parameters).trailing.is_empty()
            || super_class.is_some_and(|super_class| has_comments_that_count(super_class, f))
        {
            return true;
        }
    }

    // Prettier's `isMemberExpression(stripChainElementWrappers(e))`.
    let is_member = |mut e: Expr<'a>| {
        while let ExprKind::NonNull(inner) = e.kind() {
            e = inner;
        }
        matches!(e.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. })
    };
    match (super_class, implements.first()) {
        (Some(super_class), _) => {
            !matches!(parent, AstNodes::AssignmentExpression(_))
                && class.extends_args().is_empty()
                && is_member(super_class)
        }
        (None, Some(first)) => match first.kind() {
            TypeKind::Heritage { expr, args } => args.is_empty() && is_member(expr),
            TypeKind::Ref { name, args } => args.is_empty() && name.len() > 1,
            _ => false,
        },
        (None, None) => false,
    }
}

/// A member of a class and the `;` after it.
struct FormatClassElementWithSemicolon<'a> {
    element: Member<'a>,
    next_element: Option<Member<'a>>,
}

impl FormatClassElementWithSemicolon<'_> {
    /// Prettier's `shouldPrintSemicolonAfterClassProperty`: true if the property `element` still needs a `;` with
    /// `semi: false`.
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
        if [
            Flags::STATIC,
            Flags::PUBLIC,
            Flags::PROTECTED,
            Flags::PRIVATE,
            Flags::READONLY,
        ]
        .into_iter()
        .any(|flag| has_modifier(next, flag))
        {
            return false;
        }

        // What follows would be parsed as the rest of this property: `in`, `[a]`, `*a() {}`.
        let is_computed = next.key().is_some_and(Key::is_computed);
        if next.key().is_some_and(|key| {
            matches!(key.kind(), KeyKind::Ident(name) if matches!(name.bytes(), b"in" | b"instanceof"))
        }) {
            return true;
        }
        // Flow's `+a`, `-a`
        if next.kind() == MemberKind::Property
            && (has_modifier(next, Flags::IN) || has_modifier(next, Flags::OUT))
            && !has_modifier(next, Flags::AMBIENT)
        {
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

impl<'a> FormatClassElementWithSemicolon<'a> {
    /// See [`ignored_node_terminator_follows_semi`].
    fn write_ignored_without_terminator(&self, f: &mut Formatter<'a>) {
        let span = self.element.span();
        let has_terminator = match self.element.kind() {
            MemberKind::Property | MemberKind::IndexSignature => true,
            _ => self.element.func().is_some_and(|func| !func.has_body()),
        };
        let content = match has_terminator {
            true => f.file().without_semicolon(span),
            false => span,
        };
        let terminator = has_terminator
            && match f.options().semicolons {
                Semicolons::Always => true,
                Semicolons::AsNeeded => {
                    self.element.kind() == MemberKind::Property && self.needs_semicolon()
                }
            };
        let node = self.element.as_ast_nodes();
        write!(
            f,
            [
                leading_comments(node),
                FormatSuppressedNode(content),
                terminator.then_some(";"),
                trailing_comments(node)
            ]
        );
    }
}

impl<'a> Format<'a> for FormatClassElementWithSemicolon<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let node = self.element.as_ast_nodes();
        let is_ignored = !f.is_quiet() && f.comments().is_ignored(node);
        if is_ignored && ignored_node_terminator_follows_semi(f) {
            return self.write_ignored_without_terminator(f);
        }
        let needs_semi = self.element.kind() == MemberKind::Property
            && match f.options().semicolons {
                Semicolons::Always => !is_ignored,
                Semicolons::AsNeeded => self.needs_semicolon(),
            };
        let is_added_after_comments =
            f.options().semicolons.is_as_needed() && needed_semicolon_is_after_comments(f);
        if !needs_semi || f.is_quiet() || is_added_after_comments {
            return write!(f, [self.element, needs_semi.then_some(";")]);
        }
        // The `;` is part of the member, so the comments that trail the member come after it.
        write!(
            f,
            [
                FormatNodeWithoutTrailingComments(&self.element),
                ";",
                trailing_comments(node)
            ]
        );
    }
}

/// Without semicolons, Prettier's `printClassBody` adds the `;` that's needed after the member and its comments:
/// `static /* comment */;`. oxfmt prints `static; /* comment */`
fn needed_semicolon_is_after_comments(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// Prettier's `printMethodValue`: the type parameters, the parameters and the return type of a
/// method.
pub(crate) fn format_grouped_parameters_with_return_type_for_method<'a>(
    func: Func<'a>,
    f: &mut Formatter<'a>,
) {
    // typescript-estree has a `FunctionExpression` in a method, which starts here.
    if !f.is_quiet() {
        write!(f, leading_comments(AstNodes::Function(func)));
    }
    write!(f, type_parameters(func.type_params(), Node::Func(func)));

    group(&format_with(|f| {
        let format_parameters = FormatFormalParameters(func).memoized();
        let format_return_type = func.return_type().map(FormatTypeAnnotation).memoized();

        match should_break_function_parameters(func) {
            true => write!(
                f,
                [
                    group(&format_parameters).should_expand(true),
                    format_return_type
                ]
            ),
            false => {
                write_parameters_and_return_type(func, &format_parameters, &format_return_type, f)
            }
        }
    }))
    .fmt(f);
}

/// `constructor(public x: number, y: number) {}`: if there's more than one parameter and one has a modifier, each goes
/// on its own line.
fn should_break_function_parameters(func: Func<'_>) -> bool {
    func.params().len() > 1
        && func
            .params()
            .iter()
            .any(|param| param.modifiers().iter().any(|it| it.decorator().is_none()))
}
