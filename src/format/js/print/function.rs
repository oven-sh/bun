use super::arrow_function_expression::{FormatMaybeCachedFunctionBody, FunctionCacheMode, GroupedCallArgumentLayout};
use super::block_statement::is_empty_block;
use super::parameters::FormatFormalParameters;
use super::program::FormatStatements;
use super::semicolon::OptionalSemicolon;
use super::type_parameters::type_parameters;
use crate::js::format::{FormatTypeAnnotation, format_node_without_comments, identifier};
use crate::prelude::*;
use crate::write;

#[derive(Copy, Clone, Debug, Default)]
pub(crate) struct FormatFunctionOptions {
    pub(crate) call_argument_layout: Option<GroupedCallArgumentLayout>,
    /// Whether what is formatted is kept, to be written again.
    pub(crate) cache_mode: FunctionCacheMode,
}

/// A function declaration or expression. Not a method: see `class.rs`.
pub(crate) fn write_function<'a>(func: Func<'a>, options: FormatFunctionOptions, f: &mut Formatter<'a>) {
    let node = AstNodes::Function(func);
    let is_declared =
        matches!(func.owner(), Node::Stmt(statement) if statement.modifiers().iter().any(|it| it.flag() == Flags::AMBIENT));
    let head = format_with(|f| {
        write!(
            f,
            [
                is_declared.then_some("declare "),
                func.is_async().then_some("async "),
                "function",
                func.is_generator().then_some("*"),
                space(),
                func.name().map(|name| identifier(name, node)),
                group(&type_parameters(func.type_params(), Node::Func(func))),
            ]
        );
    });
    FormatContentWithCacheMode::new(node.span(), head, options.cache_mode).fmt(f);

    let format_parameters =
        FormatContentWithCacheMode::new(FormatFormalParameters(func).span(), FormatFormalParameters(func), options.cache_mode)
            .memoized();

    let format_return_type = func
        .return_type()
        .map(|return_type| {
            let return_type = FormatTypeAnnotation(return_type);
            let content = format_with(move |f: &mut Formatter<'a>| {
                let needs_space = f.comments().has_comment_before(return_type.span().start);
                write!(f, [maybe_space(needs_space), return_type]);
            });
            FormatContentWithCacheMode::new(return_type.span(), content, options.cache_mode)
        })
        .memoized();

    write!(
        f,
        group(&format_with(|f| {
            // The parameters have to be formatted before the return type, which
            // `should_group_function_parameters` may do.
            format_parameters.inspect(f);
            let group_parameters = should_group_function_parameters(func, &format_return_type, f);
            match group_parameters {
                true => write!(f, group(&format_parameters)),
                false => write!(f, format_parameters),
            }
            write!(f, format_return_type);
        }))
    );

    if func.has_body() {
        write!(
            f,
            [
                space(),
                FormatMaybeCachedFunctionBody {
                    func,
                    mode: options.cache_mode
                }
            ]
        );
    } else {
        write!(f, OptionalSemicolon);
    }
}

/// The `{ .. }` of a function.
#[derive(Copy, Clone)]
pub(crate) struct FormatFunctionBody<'a>(pub(crate) Func<'a>);

impl<'a> Format<'a> for FormatFunctionBody<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let func = self.0;
        let FnBody::Block(statements) = func.body() else {
            return;
        };
        let write = |f: &mut Formatter<'a>| {
            let comments = f.comments().block_comments_before(self.span().start);
            write!(f, [space(), FormatLeadingComments::Comments(comments)]);
            if is_empty_block(statements) {
                write!(f, ["{", format_dangling_comments(self.span()).with_block_indent(), "}"]);
            } else {
                write!(f, ["{", block_indent(&FormatStatements(statements)), "}"]);
            }
        };
        format_node_without_comments(self.span(), || func.as_ast_nodes(), f, write);
    }
}

impl Spanned for FormatFunctionBody<'_> {
    fn span(&self) -> Span {
        AstNodes::FunctionBody(self.0).span()
    }
}

/// Whether the parameters are a group of their own, so that the return type breaks first.
pub(crate) fn should_group_function_parameters<'a>(
    func: Func<'a>,
    formatted_return_type: &Memoized<impl Format<'a>>,
    f: &mut Formatter<'a>,
) -> bool {
    let type_parameters = func.type_params();
    match type_parameters.len() {
        0 => {}
        1 => {
            if type_parameters.first().is_some_and(|first| first.constraint().is_some() || first.default().is_some()) {
                return false;
            }
        }
        _ => return false,
    }
    let Some(return_type) = func.return_type() else {
        return false;
    };
    func.params().len() + usize::from(func.this_param().is_some()) == 1
        && (matches!(return_type.kind(), TypeKind::Object(_) | TypeKind::Mapped(_))
            || formatted_return_type.inspect(f).will_break())
}

/// Content that is formatted once and written as often as it takes to find the layout of a call
/// that it is an argument of. It cannot be formatted again, because its comments would be gone.
pub(crate) struct FormatContentWithCacheMode<T> {
    key: Span,
    content: T,
    cache_mode: FunctionCacheMode,
}

impl<T> FormatContentWithCacheMode<T> {
    /// `key`: a span that nothing else is cached under.
    pub(crate) fn new(key: Span, content: T, cache_mode: FunctionCacheMode) -> Self {
        Self {
            key,
            content,
            cache_mode,
        }
    }
}

impl<'a, T: Format<'a>> Format<'a> for FormatContentWithCacheMode<T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if matches!(self.cache_mode, FunctionCacheMode::NoCache) {
            self.content.fmt(f);
        } else if let Some(grouped) = f.context().get_cached_element(&self.key) {
            f.write_element(grouped);
        } else if let Some(grouped) = f.intern(&self.content) {
            f.context_mut().cache_element(&self.key, grouped);
            f.write_element(grouped);
        }
    }
}
