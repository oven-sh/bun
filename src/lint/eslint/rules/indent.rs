use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::prelude::*;
use smallvec::SmallVec;

/// Enforce consistent indentation.
pub struct Indent {
    /// A space or a tab.
    character: u8,
    /// How many of them are one level.
    size: u32,
    switch_case: u32,
    /// `VariableDeclarator`, for `var`, `let` and `const`.
    variable_declarator: [Offset; 3],
    outer_iife_body: Offset,
    /// `None`: `"off"`
    member_expression: Option<u32>,
    function_declaration: FunctionOffsets,
    function_expression: FunctionOffsets,
    static_block_body: u32,
    call_arguments: Offset,
    array_expression: Offset,
    object_expression: Offset,
    import_declaration: Offset,
    flat_ternary_expressions: bool,
    offset_ternary_expressions: bool,
    // TODO(api): bun_lint::selector. Until then only the names of node types match.
    ignored_nodes: Vec<Box<str>>,
    ignore_comments: bool,
}

const WRONG_INDENTATION: Message = Message::new(
    "wrongIndentation",
    "Expected indentation of {{expected}} but found {{actual}}.",
);

/// ESLint's `ELEMENT_LIST_SCHEMA`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Offset {
    Levels(u32),
    First,
    Off,
}

impl Offset {
    /// One level if the option is missing.
    fn of(value: Option<&Json>) -> Offset {
        match value {
            Some(Json::Number(levels)) => Offset::Levels(*levels as u32),
            Some(Json::String(word)) => match word.as_slice() {
                b"first" => Offset::First,
                b"off" => Offset::Off,
                _ => Offset::Levels(1),
            },
            _ => Offset::Levels(1),
        }
    }
}

#[derive(Copy, Clone)]
struct FunctionOffsets {
    parameters: Offset,
    body: u32,
}

impl Indent {
    #[inline]
    fn ignores(&self, node_type: &str) -> bool {
        !self.ignored_nodes.is_empty() && self.ignored_nodes.iter().any(|it| &**it == node_type)
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut offsets = Offsets::new(self, cx.file());
        offsets.compute();
        offsets.report(cx);
    }
}

impl Rule for Indent {
    const META: Meta = Meta::eslint("indent", Kind::Layout).fixable(Fixable::Whitespace).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let is_tab = options.str(0) == Some("tab");
        let object = options.object(1);
        let levels = |object: Object, key: &str, default: u32| object.number(key).map_or(default, |it| it as u32);
        let function = |key: &str| FunctionOffsets {
            parameters: Offset::of(object.object(key).get("parameters")),
            body: levels(object.object(key), "body", 1),
        };
        let kinds = object.object("VariableDeclarator");
        Indent {
            character: if is_tab { b'\t' } else { b' ' },
            size: if is_tab { 1 } else { options.number(0).map_or(4, |it| it as u32) },
            switch_case: levels(object, "SwitchCase", 0),
            variable_declarator: match object.get("VariableDeclarator") {
                Some(Json::Object(_)) => ["var", "let", "const"].map(|kind| Offset::of(kinds.get(kind))),
                // Upstream looks the kind up in the string, and finds nothing.
                Some(Json::String(word)) if word.as_slice() == b"off" => [Offset::Levels(1); 3],
                all => [Offset::of(all); 3],
            },
            outer_iife_body: Offset::of(object.get("outerIIFEBody")),
            member_expression: match object.get("MemberExpression") {
                Some(Json::Number(levels)) => Some(*levels as u32),
                Some(_) => None,
                None => Some(1),
            },
            function_declaration: function("FunctionDeclaration"),
            function_expression: function("FunctionExpression"),
            static_block_body: levels(object.object("StaticBlock"), "body", 1),
            call_arguments: Offset::of(object.object("CallExpression").get("arguments")),
            array_expression: Offset::of(object.get("ArrayExpression")),
            object_expression: Offset::of(object.get("ObjectExpression")),
            import_declaration: Offset::of(object.get("ImportDeclaration")),
            flat_ternary_expressions: object.bool_or("flatTernaryExpressions", false),
            offset_ternary_expressions: object.bool_or("offsetTernaryExpressions", false),
            ignored_nodes: object.strings("ignoredNodes").into_iter().map(Box::from).collect(),
            ignore_comments: object.bool_or("ignoreComments", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}

/// No token.
const NONE: u32 = u32::MAX;

/// A token or a comment. Everywhere below, one is referred to by its index among all of them.
#[derive(Copy, Clone)]
struct Tok {
    start: u32,
    end: u32,
    /// The line that it starts on.
    line: u32,
    end_line: u32,
    kind: TokenKind,
}

/// How a token is to be indented: by `offset` levels more than the token `from`, or than the first
/// column.
#[derive(Copy, Clone)]
struct Descriptor {
    from: u32,
    offset: u32,
    /// The offset also applies if the two are on the same line.
    is_forced: bool,
}

/// The whitespace that a line is to start with: the indentation of the token `base` as it is
/// written, and `extra` spaces or tabs.
#[derive(Copy, Clone)]
struct Indentation {
    base: u32,
    extra: u32,
}

impl Indentation {
    const UNKNOWN: Indentation = Indentation {
        base: NONE,
        extra: u32::MAX,
    };
}

/// ESLint's `_ignoredTokens`.
const IS_IGNORED: u8 = 1 << 0;
/// ESLint's `parameterParens`.
const IS_PARAMETER_PAREN: u8 = 1 << 1;
/// ESLint's `ignoredNodeFirstTokens`.
const STARTS_IGNORED_NODE: u8 = 1 << 2;

/// What is left to visit. One step is one node of ESTree, whose listeners run before the steps for
/// its children, which it leaves on the stack.
#[derive(Copy, Clone)]
enum Step<'a> {
    /// In a list of statements.
    Stmt(Stmt<'a>),
    /// The child of a node that is not a list of statements and starts at this offset.
    Body(Stmt<'a>, u32),
    /// After the children of a loop, an `if` or a `with`.
    ExitStmt(Stmt<'a>),
    CatchClause(Stmt<'a>),
    Case(Case<'a>),
    VarDecl(VarDecl<'a>),
    Expr(Expr<'a>),
    /// What is assigned to.
    Target(Expr<'a>),
    Prop(Prop<'a>),
    /// In an object that is assigned to.
    TargetProp(Prop<'a>),
    Func(Func<'a>),
    FuncBody(Func<'a>),
    Param(Param<'a>),
    /// Without its modifiers.
    InnerParam(Param<'a>),
    /// The pattern of a parameter with a default value.
    ParamPat(Param<'a>),
    VarPat(VarDecl<'a>),
    Pat(Pat<'a>),
    PatProp(PatProp<'a>),
    /// The pattern and the default value.
    PatPropValue(PatProp<'a>),
    PatElem(PatElem<'a>),
    ClassBody(Class<'a>),
    Member(Member<'a>),
    JsxName(Expr<'a>),
    JsxAttribute(Prop<'a>),
    JsxAttributeValue(Expr<'a>),
    JsxChild(Expr<'a>),
    JsxClosing(Expr<'a>),
    Type(TypeNode<'a>),
    TypeParam(TypeParam<'a>),
    TupleElem(TupleElem<'a>),
    EnumMember(EnumMember<'a>),
    /// The `a.b` of the type `typeof a.b`.
    QueryName(Expr<'a>),
    /// The `MemberExpression` in a heritage clause: its object and its property.
    MemberName(Span, Span),
    /// A node that has no listener of its own.
    Enter(&'static str, Span),
    /// A node of a type that ESLint's rule does not know.
    EnterUnknown(&'static str, Span),
    ExitUnknown(&'static str, Span),
}

/// ESLint's `OffsetStorage` and `TokenInfo`, and the walk that fills them.
///
/// Upstream keeps a descriptor for each range of the text. Here each token has its own: setting
/// the offsets of a range is a `fill`.
struct Offsets<'a, 'r> {
    rule: &'r Indent,
    file: &'a File<'a>,
    tokens: Vec<Tok>,
    /// For each offset in the text, how many tokens and comments start before it.
    index: Vec<u32>,
    /// ESLint's `firstTokensByLineNumber`.
    first_of_line: Vec<u32>,
    descriptors: Vec<Descriptor>,
    flags: Vec<u8>,
    /// ESLint's `_lockedFirstTokens`. Empty until there is one.
    locked: Vec<u32>,
    /// ESLint's `_desiredIndentCache`.
    desired: Vec<Indentation>,
    stack: Vec<Step<'a>>,
    /// ESLint's `ignoredNodes`.
    ignored: Vec<Span>,
    /// The walk only looks for the nodes that are ignored, which have to be known before any
    /// listener runs.
    is_collecting: bool,
    has_collected: bool,
    /// A walk that was not preceded by one that collects has met a node that is ignored.
    is_stale: bool,
}

/// The range of the `ExportNamedDeclaration` or `ExportDefaultDeclaration` around a declaration.
fn export_span(statement: Stmt) -> Option<Span> {
    let modifiers = statement.modifiers();
    if modifiers.is_empty()
        || !matches!(
            statement.tag(),
            StmtTag::Fn
                | StmtTag::Var
                | StmtTag::Class
                | StmtTag::TypeAlias
                | StmtTag::Interface
                | StmtTag::Enum
                | StmtTag::Module
                | StmtTag::ImportEquals
        )
    {
        return None;
    }
    let first_keyword = modifiers.iter().map(Modifier::flag).find(|it| !it.is_empty());
    (first_keyword == Some(Flags::EXPORT)).then(|| statement.export_span()).flatten()
}

/// The range of ESLint's node for a statement.
fn statement_span(statement: Stmt) -> Span {
    export_span(statement).unwrap_or_else(|| statement.span())
}

/// It is a `TSParameterProperty`.
fn has_keywords(param: Param) -> bool {
    param.modifiers().iter().any(|it| it.decorator().is_none())
}

/// The range of ESLint's node for a parameter.
fn parameter_span(param: Param) -> Span {
    match param.default() {
        _ if has_keywords(param) || param.is_rest() => param.span(),
        Some(default) => Span::new(param.pat().span().start, default.outer_span().end),
        None => param.binding_span(),
    }
}

fn jsx_child_span(child: JsxChild) -> Span {
    match child {
        JsxChild::Expr(e) => e.jsx_container_span().unwrap_or_else(|| e.span()),
        JsxChild::Whitespace(span) => span,
    }
}

/// ESLint's `isOuterIIFE`, for the function or the class `callee`.
fn is_outer_iife(callee: Expr) -> bool {
    let Node::Expr(call) = callee.parent() else {
        return false;
    };
    if !matches!(call.kind(), ExprKind::Call(it) if it.callee() == callee && it.chain() == Chain::No) {
        return false;
    }
    let mut at = Node::Expr(call);
    loop {
        at = at.parent();
        match at {
            Node::Expr(e) => match e.kind() {
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::BitNot | UnOp::Plus | UnOp::Minus,
                    ..
                }
                | ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    ..
                } => {}
                ExprKind::Assign { .. } if !e.is_assignment_target() => {}
                _ => return false,
            },
            Node::VarDecl(_) => {}
            Node::Stmt(statement) => {
                return matches!(statement.kind(), StmtKind::Expr(_) | StmtKind::Var(_))
                    && matches!(statement.parent(), Node::File(_))
                    && export_span(statement).is_none();
            }
            _ => return false,
        }
    }
}

// ───────────────────────────── tokens ─────────────────────────────

impl<'a, 'r> Offsets<'a, 'r> {
    fn new(rule: &'r Indent, file: &'a File<'a>) -> Self {
        let line_count = file.line_count();
        let start_of_line = |line: u32| match line <= line_count {
            true => file.line_span(line).start,
            false => u32::MAX,
        };

        let all = file.tokens().with_comments();
        let mut tokens = Vec::with_capacity(all.len());
        let (mut line, mut next_line) = (1, start_of_line(2));
        for token in all {
            let span = token.span();
            while span.start >= next_line {
                line += 1;
                next_line = start_of_line(line + 1);
            }
            tokens.push(Tok {
                start: span.start,
                end: span.end,
                line,
                end_line: if span.end < next_line { line } else { file.line_of(span.end) },
                kind: token.kind(),
            });
        }

        let mut index = vec![tokens.len() as u32; file.text().len() + 1];
        let mut at = 0;
        for (i, token) in tokens.iter().enumerate() {
            let until = token.start as usize + 1;
            if let Some(before) = index.get_mut(at..until) {
                before.fill(i as u32);
            }
            at = until;
        }

        let mut first_of_line = vec![NONE; line_count as usize + 2];
        for (i, token) in tokens.iter().enumerate() {
            if let Some(first) = first_of_line.get_mut(token.line as usize)
                && *first == NONE
            {
                *first = i as u32;
            }
            if token.end_line != token.line
                && let Some(first) = first_of_line.get_mut(token.end_line as usize)
                && *first == NONE
                && !text::is_blank(file.slice(Span::new(start_of_line(token.end_line), token.end)))
            {
                *first = i as u32;
            }
        }

        let count = tokens.len();
        Offsets {
            rule,
            file,
            tokens,
            index,
            first_of_line,
            descriptors: Vec::with_capacity(count),
            flags: Vec::with_capacity(count),
            locked: Vec::new(),
            desired: vec![Indentation::UNKNOWN; count],
            stack: Vec::new(),
            ignored: Vec::new(),
            is_collecting: false,
            has_collected: false,
            is_stale: false,
        }
    }

    #[inline]
    fn token(&self, i: usize) -> Tok {
        self.tokens.get(i).copied().unwrap_or(Tok {
            start: 0,
            end: 0,
            line: 0,
            end_line: 0,
            kind: TokenKind::Punctuator,
        })
    }

    #[inline]
    fn text_of(&self, i: usize) -> &'a [u8] {
        let token = self.token(i);
        self.file.slice(Span::new(token.start, token.end))
    }

    #[inline]
    fn is_comment(&self, i: usize) -> bool {
        self.token(i).kind.is_comment()
    }

    #[inline]
    fn is_punctuator(&self, i: usize, text: &[u8]) -> bool {
        self.token(i).kind == TokenKind::Punctuator && self.text_of(i) == text
    }

    /// The first token or comment that starts at `offset` or after it. The number of them all if
    /// there is none.
    #[inline]
    fn lower_bound(&self, offset: u32) -> usize {
        self.index.get(offset as usize).map_or(self.tokens.len(), |&i| i as usize)
    }

    /// `getTokenBefore(token)`
    fn before(&self, i: usize) -> Option<usize> {
        (0..i.min(self.tokens.len())).rev().find(|&it| !self.is_comment(it))
    }

    /// `getTokenAfter(token)`
    fn after(&self, i: usize) -> Option<usize> {
        (i + 1..self.tokens.len()).find(|&it| !self.is_comment(it))
    }

    /// `getFirstToken(node)` with the start of the node, `getTokenAfter(node)` with its end.
    fn token_from(&self, offset: u32) -> Option<usize> {
        (self.lower_bound(offset)..self.tokens.len()).find(|&it| !self.is_comment(it))
    }

    /// `getLastToken(node)` with the end of the node, `getTokenBefore(node)` with its start.
    fn token_until(&self, offset: u32) -> Option<usize> {
        self.before(self.lower_bound(offset))
    }

    /// `getTokenAfter(node, isNotClosingParenToken)` with the end of the node.
    fn token_after_parens(&self, offset: u32) -> Option<usize> {
        let mut token = self.token_from(offset)?;
        while self.is_punctuator(token, b")") {
            token = self.after(token)?;
        }
        Some(token)
    }

    /// `getTokenBefore(node, isNotOpeningParenToken)` with the start of the node.
    fn token_before_parens(&self, offset: u32) -> Option<usize> {
        let mut token = self.token_until(offset)?;
        while self.is_punctuator(token, b"(") {
            token = self.before(token)?;
        }
        Some(token)
    }

    /// `getTokenAfter(node, token => token.value === text)` with the end of the node.
    fn punctuator_from(&self, offset: u32, text: &[u8]) -> Option<usize> {
        let mut token = self.token_from(offset)?;
        while !self.is_punctuator(token, text) {
            token = self.after(token)?;
        }
        Some(token)
    }

    /// `getTokenBefore(node, token => token.value === text)` with the start of the node.
    fn punctuator_until(&self, offset: u32, text: &[u8]) -> Option<usize> {
        let mut token = self.token_until(offset)?;
        while !self.is_punctuator(token, text) {
            token = self.before(token)?;
        }
        Some(token)
    }

    fn first_token_of_line(&self, line: u32) -> Option<usize> {
        let first = self.first_of_line.get(line as usize).copied()?;
        (first != NONE).then_some(first as usize)
    }

    /// ESLint's `isFirstTokenOfLine`.
    #[inline]
    fn is_first_token_of_line(&self, i: usize) -> bool {
        self.first_token_of_line(self.token(i).line) == Some(i)
    }

    /// ESLint's `getTokenIndent`.
    fn indent_of(&self, i: usize) -> &'a [u8] {
        let token = self.token(i);
        self.file.slice(Span::new(self.file.line_span(token.line).start, token.start))
    }

    #[inline]
    fn has_flag(&self, i: usize, flag: u8) -> bool {
        self.flags.get(i).is_some_and(|it| it & flag != 0)
    }

    #[inline]
    fn add_flag(&mut self, i: usize, flag: u8) {
        if let Some(flags) = self.flags.get_mut(i) {
            *flags |= flag;
        }
    }
}

// ───────────────────────────── offsets ─────────────────────────────

impl<'a> Offsets<'a, '_> {
    /// ESLint's `matchOffsetOf`.
    fn match_offset_of(&mut self, base: usize, token: usize) {
        if self.locked.is_empty() {
            self.locked.resize(self.tokens.len(), NONE);
        }
        if let Some(locked) = self.locked.get_mut(token) {
            *locked = base as u32;
        }
    }

    /// ESLint's `setDesiredOffset`.
    fn set_offset(&mut self, token: usize, from: Option<usize>, offset: u32) {
        if from != Some(token)
            && let Some(descriptor) = self.descriptors.get_mut(token)
        {
            *descriptor = Descriptor {
                from: from.map_or(NONE, |it| it as u32),
                offset,
                is_forced: false,
            };
        }
    }

    /// ESLint's `setDesiredOffsets`, for the tokens that start in `start..end`.
    fn set_offsets(&mut self, start: u32, end: u32, from: Option<usize>, offset: u32, is_forced: bool) {
        let (first, after) = (self.lower_bound(start), self.lower_bound(end));
        let own = from.filter(|&it| first <= it && it < after && self.token(it).end <= end);
        let kept = own.and_then(|it| self.descriptors.get(it).copied());
        if let Some(descriptors) = self.descriptors.get_mut(first..after) {
            descriptors.fill(Descriptor {
                from: from.map_or(NONE, |it| it as u32),
                offset,
                is_forced,
            });
        }
        if let (Some(own), Some(kept)) = (own, kept)
            && let Some(descriptor) = self.descriptors.get_mut(own)
        {
            *descriptor = kept;
        }
    }

    /// ESLint's `ignoreToken`.
    fn ignore_token(&mut self, token: usize) {
        if self.is_first_token_of_line(token) {
            self.add_flag(token, IS_IGNORED);
        }
    }

    /// ESLint's `getFirstDependency`.
    #[inline]
    fn first_dependency(&self, token: usize) -> u32 {
        self.descriptors.get(token).map_or(NONE, |it| it.from)
    }

    /// `/^\s*?\n/u.test(token.value)`
    fn starts_with_line_feed(&self, i: usize) -> bool {
        let text = self.text_of(i);
        let value = match self.token(i).kind {
            TokenKind::JsxText => text,
            TokenKind::Block => text.get(2..text.len().saturating_sub(2)).unwrap_or_default(),
            _ => return false,
        };
        strings::index_of_char_usize(value, b'\n').is_some_and(|at| text::is_blank(&value[..at]))
    }

    /// ESLint's `getDesiredIndent`.
    fn desired_indent(&mut self, token: usize) -> Indentation {
        // The tokens on the way whose indentation is not known yet, with what each adds to that of
        // the next.
        let mut pending: SmallVec<[(usize, u32); 16]> = SmallVec::new();
        let mut at = token;
        let mut indentation = loop {
            match self.desired.get(at) {
                Some(known) if known.extra != u32::MAX => break *known,
                Some(_) => {}
                None => break Indentation { base: NONE, extra: 0 },
            }
            if self.has_flag(at, IS_IGNORED) {
                pending.push((at, 0));
                break Indentation {
                    base: at as u32,
                    extra: 0,
                };
            }
            let locked = self.locked.get(at).copied().filter(|&it| it != NONE);
            let (from, extra) = match locked {
                Some(first) => {
                    let first = self.token(first as usize);
                    let first_of_line = self.first_token_of_line(first.line);
                    let start = first_of_line.map_or(first.start, |it| self.token(it).start);
                    (first_of_line, text::utf16_len(self.file.slice(Span::new(start, first.start))))
                }
                None => {
                    let Some(&descriptor) = self.descriptors.get(at) else {
                        break Indentation { base: NONE, extra: 0 };
                    };
                    let from = (descriptor.from != NONE).then_some(descriptor.from as usize);
                    let is_collapsed = !descriptor.is_forced
                        && from.is_some_and(|it| self.token(it).line == self.token(at).line)
                        && !self.starts_with_line_feed(at);
                    (from, if is_collapsed { 0 } else { descriptor.offset.saturating_mul(self.rule.size) })
                }
            };
            pending.push((at, extra));
            match from {
                Some(from) if pending.len() <= self.tokens.len() => at = from,
                _ => break Indentation { base: NONE, extra: 0 },
            }
        };
        for &(token, extra) in pending.iter().rev() {
            indentation.extra = indentation.extra.saturating_add(extra).min(u32::MAX - 1);
            if let Some(desired) = self.desired.get_mut(token) {
                *desired = indentation;
            }
        }
        indentation
    }

    /// ESLint's `validateTokenIndent`.
    fn is_indented_by(&self, token: usize, desired: Indentation) -> bool {
        let actual = self.indent_of(token);
        let base: &[u8] = if desired.base == NONE { b"" } else { self.indent_of(desired.base as usize) };
        let is_as_desired = actual.len() == base.len() + desired.extra as usize
            && actual.starts_with(base)
            && actual[base.len()..].iter().all(|it| *it == self.rule.character);
        is_as_desired || strings::contains_char(actual, b' ') && strings::contains_char(actual, b'\t')
    }

    /// ESLint's `hasBlankLinesBetween`.
    fn has_blank_lines_between(&self, first: usize, second: usize) -> bool {
        let mut lines = self.token(first).end_line + 1..self.token(second).line;
        lines.any(|line| self.first_token_of_line(line).is_none())
    }

    /// ESLint's `countTrailingLinebreaks(token.value)`.
    fn count_trailing_linebreaks(&self, token: usize) -> u32 {
        // No other token ends with whitespace.
        if self.token(token).kind != TokenKind::JsxText {
            return 0;
        }
        let value = self.text_of(token);
        let trailing = &value[text::trim_end(value).len()..];
        ast_utils::create_global_linebreak_matcher(trailing).count() as u32
    }

    /// ESLint's `addElementListIndent`. A hole in an array is `None`.
    fn add_element_list_indent(
        &mut self,
        elements: impl Iterator<Item = Option<Span>>,
        start: usize,
        end: usize,
        offset: Offset,
    ) {
        let levels = match offset {
            Offset::Levels(levels) => levels,
            _ => 1,
        };
        self.set_offsets(self.token(start).end, self.token(end).start, Some(start), levels, false);
        self.set_offset(end, Some(start), 0);

        // The first token of an element, including the parentheses around it.
        let first_token_of = |offsets: &Self, element: Span| {
            let mut token = offsets.token_until(element.start)?;
            while token != start && offsets.is_punctuator(token, b"(") {
                token = offsets.before(token)?;
            }
            offsets.after(token)
        };
        let mut first_token_of_first = None;
        // The element before, and its first token.
        let mut previous: Option<(Span, usize)> = None;
        for (i, element) in elements.enumerate() {
            let Some(element) = element else {
                if i == 0 && offset == Offset::First {
                    return;
                }
                previous = None;
                continue;
            };
            let Some(first_token) = first_token_of(self, element) else {
                return;
            };
            if offset == Offset::Off {
                self.ignore_token(first_token);
            }
            if i == 0 {
                first_token_of_first = Some(first_token);
            } else if offset == Offset::First && self.is_first_token_of_line(first_token) {
                if let Some(base) = first_token_of_first {
                    self.match_offset_of(base, first_token);
                }
            } else if let Some((previous, first_token_of_previous)) = previous
                && let Some(last_token) = self.token_until(previous.end)
                && self.token(last_token).end_line.saturating_sub(self.count_trailing_linebreaks(last_token))
                    > self.token(start).end_line
            {
                self.set_offsets(previous.end, element.end, Some(first_token_of_previous), 0, false);
            }
            previous = Some((element, first_token));
        }
    }

    /// ESLint's `addBlocklessNodeIndent`, for a node that is not a block.
    fn add_blockless_node_indent(&mut self, node: Span) -> Option<()> {
        let last_parent_token = self.token_before_parens(node.start)?;
        let (mut first, mut last) = (self.token_from(node.start)?, self.token_until(node.end)?);
        while let (Some(before), Some(after)) = (self.before(first), self.after(last))
            && self.is_punctuator(before, b"(")
            && self.is_punctuator(after, b")")
        {
            (first, last) = (before, after);
        }
        self.set_offsets(self.token(first).start, self.token(last).end, Some(last_parent_token), 1, false);
        Some(())
    }

    fn add_blockless_statement_indent(&mut self, body: Stmt<'a>) {
        if !matches!(body.kind(), StmtKind::Block(_)) {
            self.add_blockless_node_indent(body.span());
        }
    }

    fn add_parameter_parens(&mut self, opening: usize, closing: usize) {
        self.add_flag(opening, IS_PARAMETER_PAREN);
        self.add_flag(closing, IS_PARAMETER_PAREN);
    }

    /// ESLint's `addParensIndent`.
    fn add_parens_indent(&mut self) {
        let (mut open, mut pairs) = (Vec::new(), Vec::new());
        for i in 0..self.tokens.len() {
            if self.is_punctuator(i, b"(") {
                open.push(i);
            } else if self.is_punctuator(i, b")")
                && let Some(left) = open.pop()
            {
                pairs.push((left, i));
            }
        }
        for &(left, right) in pairs.iter().rev() {
            if !self.has_flag(left, IS_PARAMETER_PAREN) && !self.has_flag(right, IS_PARAMETER_PAREN) {
                for token in left + 1..right {
                    let from = self.first_dependency(token) as usize;
                    let is_from_inside = left < from && from < right && !self.is_comment(from);
                    if !is_from_inside && !self.is_comment(token) {
                        self.set_offset(token, Some(left), 1);
                    }
                }
            }
            self.set_offset(right, Some(left), 0);
        }
    }

    /// ESLint's `ignoreNode`.
    fn ignore_node(&mut self, node: Span) {
        let tokens = self.lower_bound(node.start)..self.lower_bound(node.end);
        for token in tokens.clone() {
            if tokens.contains(&(self.first_dependency(token) as usize)) {
                continue;
            }
            match self.first_token_of_line(self.token(token).line) {
                Some(first) if first != token => self.set_offset(token, Some(first), 0),
                _ => self.ignore_token(token),
            }
        }
    }

    /// ESLint's `addToIgnoredNodes`.
    fn add_to_ignored_nodes(&mut self, node: Span) {
        self.ignored.push(node);
        if let Some(first) = self.token_from(node.start)
            && self.token(first).end <= node.end
        {
            self.add_flag(first, STARTS_IGNORED_NODE);
        }
    }

    /// What ESLint's rule does when it leaves the `Program`, up to the check of the lines.
    fn compute(&mut self) {
        let is_espree = self.file.language().parser == Parser::Espree && self.file.is_javascript();
        self.has_collected = !is_espree || !self.rule.ignored_nodes.is_empty();
        loop {
            let root = Descriptor {
                from: NONE,
                offset: 0,
                is_forced: false,
            };
            self.descriptors.clear();
            self.descriptors.resize(self.tokens.len(), root);
            self.flags.clear();
            self.flags.resize(self.tokens.len(), 0);
            self.locked.clear();
            if self.has_collected {
                self.is_collecting = true;
                self.walk(is_espree);
                self.is_collecting = false;
            }
            self.walk(is_espree);
            if !self.is_stale {
                break;
            }
            (self.is_stale, self.has_collected) = (false, true);
        }
        if self.rule.ignore_comments {
            for i in 0..self.tokens.len() {
                if self.is_comment(i) {
                    self.ignore_token(i);
                }
            }
        }
        for node in std::mem::take(&mut self.ignored) {
            self.ignore_node(node);
        }
        self.add_parens_indent();
    }

    /// Checks the first token of each line.
    fn report(&mut self, cx: &Cx<'a, Indent>) {
        for line in 1..=self.file.line_count() {
            let Some(first) = self.first_token_of_line(line) else {
                continue;
            };
            // A token of several lines is checked where it starts.
            if self.token(first).line != line {
                continue;
            }
            if self.is_comment(first) {
                let (before, after) = (self.before(first), self.after(first));
                if let Some(after) = after
                    && self.is_punctuator(after, b";")
                    && self.token(first).end_line != self.token(after).line
                {
                    self.set_offset(first, Some(after), 0);
                }
                // A comment can also be aligned with the token before or after it.
                let mut is_aligned = false;
                for (neighbor, is_before) in [(before, true), (after, false)] {
                    let Some(neighbor) = neighbor else {
                        continue;
                    };
                    let has_blank_lines = match is_before {
                        true => self.has_blank_lines_between(neighbor, first),
                        false => self.has_blank_lines_between(first, neighbor),
                    };
                    if !is_aligned && !has_blank_lines {
                        let desired = self.desired_indent(neighbor);
                        is_aligned = self.is_indented_by(first, desired);
                    }
                }
                if is_aligned {
                    continue;
                }
            }
            let desired = self.desired_indent(first);
            if !self.is_indented_by(first, desired) {
                self.report_token(cx, first, desired);
            }
        }
    }

    fn report_token(&self, cx: &Cx<'a, Indent>, token: usize, desired: Indentation) {
        let plural = |count: usize| if count == 1 { "" } else { "s" };
        let (actual, character) = (self.indent_of(token), self.rule.character);
        let base: &'a [u8] = if desired.base == NONE { b"" } else { self.indent_of(desired.base as usize) };
        let is_tab = character == b'\t';
        let expected = text::utf16_len(base) as usize + desired.extra as usize;
        let (spaces, tabs) = (strings::count_char(actual, b' '), strings::count_char(actual, b'\t'));
        let found = match (spaces, tabs) {
            (1.., _) if is_tab => format!("{spaces} space{}", plural(spaces)),
            (1.., _) => spaces.to_string(),
            (0, 1..) if is_tab => tabs.to_string(),
            (0, 1..) => format!("{tabs} tab{}", plural(tabs)),
            (0, 0) => "0".to_owned(),
        };
        let end = self.token(token).start;
        let span = Span::new(end - actual.len() as u32, end);
        cx.report(span, WRONG_INDENTATION)
            .data(
                "expected",
                format!("{expected} {}{}", if is_tab { "tab" } else { "space" }, plural(expected)),
            )
            .data("actual", found)
            .fix(|fixer| {
                let mut indentation = base.to_vec();
                indentation.resize(base.len() + desired.extra as usize, character);
                fixer.replace(span, indentation)
            });
    }
}

// ───────────────────────────── the walk ─────────────────────────────

impl<'a> Offsets<'a, '_> {
    /// Visits the nodes in the order in which ESLint traverses them.
    fn walk(&mut self, is_espree: bool) {
        self.stack.clear();
        let Some(first) = self.token_from(0) else {
            return;
        };
        // That of typescript-estree starts with the first token.
        let start = if is_espree { 0 } else { self.token(first).start };
        self.enter("Program", Span::new(start, self.file.span().end));
        self.stack.extend(self.file.body().iter().rev().map(Step::Stmt));
        while let Some(step) = self.stack.pop() {
            let children = self.stack.len();
            self.visit(step);
            if self.is_stale {
                return;
            }
            if let Some(children) = self.stack.get_mut(children..) {
                children.reverse();
            }
        }
    }

    /// Called with each node of a type that ESLint's rule knows, before its children. Returns
    /// whether the listener for its type is to run.
    fn enter(&mut self, node_type: &'static str, node: Span) -> bool {
        let is_ignored = self.rule.ignores(node_type);
        if self.is_collecting {
            if is_ignored {
                self.add_to_ignored_nodes(node);
            }
            return false;
        }
        if is_ignored {
            return false;
        }
        // The listener for `*`.
        if let Some(first) = self.token_from(node.start)
            && !self.has_flag(first, STARTS_IGNORED_NODE)
        {
            self.set_offsets(node.start, node.end, Some(first), 0, false);
        }
        true
    }

    /// Whether the walk looks for nodes of the types that the options name.
    #[inline]
    fn is_matching(&self) -> bool {
        self.is_collecting && !self.rule.ignored_nodes.is_empty()
    }

    /// A node that is one token: no listener does anything with it.
    #[inline]
    fn leaf(&mut self, node_type: &'static str, node: impl Spanned) {
        if self.is_matching() {
            self.stack.push(Step::Enter(node_type, node.span()));
        }
    }

    fn open_unknown(&mut self, node_type: &'static str, node: Span) {
        if self.is_matching() {
            self.stack.push(Step::EnterUnknown(node_type, node));
        } else if !self.has_collected {
            self.is_stale = true;
        }
    }

    fn close_unknown(&mut self, node_type: &'static str, node: Span) {
        if self.is_collecting {
            self.stack.push(Step::ExitUnknown(node_type, node));
        }
    }

    /// A node of a type that ESLint's rule does not know. `children` leaves the steps for its
    /// children on the stack.
    fn unknown(&mut self, node_type: &'static str, node: Span, children: impl FnOnce(&mut Self)) {
        self.open_unknown(node_type, node);
        children(self);
        self.close_unknown(node_type, node);
    }

    fn visit(&mut self, step: Step<'a>) {
        match step {
            Step::Stmt(statement) => self.statement(statement, None),
            Step::Body(statement, parent) => self.statement(statement, Some(parent)),
            Step::ExitStmt(statement) => self.exit_statement(statement),
            Step::CatchClause(statement) => self.catch_clause(statement),
            Step::Case(case) => self.switch_case(case),
            Step::VarDecl(declaration) => self.variable_declarator(declaration),
            Step::Expr(e) => self.expression(e),
            Step::Target(e) => self.target(e),
            Step::Prop(prop) => self.property(prop, false),
            Step::TargetProp(prop) => self.property(prop, true),
            Step::Func(func) => self.function(func),
            Step::FuncBody(func) => self.function_body(func),
            Step::Param(param) => self.parameter(param),
            Step::InnerParam(param) => self.inner_parameter(param, false),
            Step::ParamPat(param) => self.pattern(param.pat(), param.binding_span(), param.ty(), None),
            Step::VarPat(declaration) => {
                self.pattern(declaration.pat(), declaration.binding_span(), declaration.ty(), None);
            }
            Step::Pat(pat) => self.pattern(pat, pat.span(), None, None),
            Step::PatProp(prop) => self.pattern_property(prop),
            Step::PatPropValue(prop) => {
                let value = prop.value();
                if let Some(default) = prop.default() {
                    self.enter("AssignmentPattern", Span::new(value.span().start, default.outer_span().end));
                    self.stack.push(Step::Pat(value));
                    self.stack.push(Step::Expr(default));
                }
            }
            Step::PatElem(element) => self.pattern_element(element),
            Step::ClassBody(class) => self.class_body(class),
            Step::Member(member) => self.member(member),
            Step::JsxName(name) => self.jsx_name(name),
            Step::JsxAttribute(attribute) => self.jsx_attribute(attribute),
            Step::JsxAttributeValue(value) => self.jsx_child(value, "Literal"),
            Step::JsxChild(child) => self.jsx_child(child, "JSXText"),
            Step::JsxClosing(element) => self.jsx_closing(element),
            Step::Type(ty) => self.type_node(ty),
            Step::TypeParam(param) => self.unknown("TSTypeParameter", param.span(), |it| {
                it.leaf("Identifier", param.name());
                it.stack.extend(param.constraint().map(Step::Type));
                it.stack.extend(param.default().map(Step::Type));
            }),
            Step::TupleElem(element) => self.tuple_element(element),
            Step::EnumMember(member) => self.unknown("TSEnumMember", member.span(), |it| {
                if let Some(key) = member.key() {
                    it.key(key);
                }
                it.stack.extend(member.init().map(Step::Expr));
            }),
            Step::QueryName(name) => match name.kind() {
                ExprKind::Dot { obj, name: right, .. } => self.unknown("TSQualifiedName", name.span(), |it| {
                    it.stack.push(Step::QueryName(obj));
                    it.leaf("Identifier", right);
                }),
                ExprKind::This => self.leaf("ThisExpression", name),
                _ => self.leaf("Identifier", name),
            },
            Step::MemberName(object, property) => {
                if self.enter("MemberExpression", object.to(property)) {
                    self.member_expression(object, property, false, property.end);
                }
            }
            Step::Enter(node_type, node) => {
                self.enter(node_type, node);
            }
            Step::EnterUnknown(node_type, node) => {
                if self.rule.ignores(node_type) {
                    self.add_to_ignored_nodes(node);
                }
            }
            Step::ExitUnknown(node_type, node) => {
                if !self.rule.ignores(node_type) {
                    self.add_to_ignored_nodes(node);
                }
            }
        }
    }
}

// ───────────────────────────── statements ─────────────────────────────

impl<'a> Offsets<'a, '_> {
    /// `parent`: where its parent starts, unless that is a list of statements.
    fn statement(&mut self, statement: Stmt<'a>, parent: Option<u32>) {
        let mut span = statement.span();
        if let Some(export) = export_span(statement) {
            let node_type = match statement.is_default_export() {
                true => "ExportDefaultDeclaration",
                false => "ExportNamedDeclaration",
            };
            self.enter(node_type, export);
            span = statement.span_without_export();
        }
        let in_body = |body: Stmt<'a>| Step::Body(body, span.start);
        // What is in the head of a `for`.
        let head = |head: Stmt<'a>, is_target: bool| match head.kind() {
            StmtKind::Expr(e) if is_target => (Step::Target(e), e.span()),
            StmtKind::Expr(e) => (Step::Expr(e), e.span()),
            _ => (Step::Stmt(head), head.span()),
        };
        match statement.kind() {
            StmtKind::Empty => self.leaf("EmptyStatement", span),
            StmtKind::Debugger => {
                self.enter("DebuggerStatement", span);
            }
            StmtKind::Expr(e) => {
                self.enter("ExpressionStatement", span);
                self.stack.push(Step::Expr(e));
            }
            StmtKind::Var(declarations) => {
                if self.enter("VariableDeclaration", span) {
                    self.variable_declaration(span, declarations);
                }
                self.stack.extend(declarations.iter().map(Step::VarDecl));
            }
            StmtKind::Fn(func) => self.function(func),
            StmtKind::Class(class) => self.class(class, "ClassDeclaration"),
            StmtKind::Return(argument) => {
                self.enter("ReturnStatement", span);
                self.stack.extend(argument.map(Step::Expr));
            }
            StmtKind::Throw(argument) => {
                self.enter("ThrowStatement", span);
                self.stack.push(Step::Expr(argument));
            }
            StmtKind::If { test, yes, no } => {
                let is_listening = self.enter("IfStatement", span);
                if is_listening {
                    self.add_blockless_statement_indent(yes);
                    if let Some(no) = no {
                        self.add_blockless_statement_indent(no);
                    }
                }
                self.stack.push(Step::Expr(test));
                self.stack.push(in_body(yes));
                self.stack.extend(no.map(in_body));
                self.stack.extend(is_listening.then_some(Step::ExitStmt(statement)));
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                let init = init.map(|it| head(it, false));
                let is_listening = self.enter("ForStatement", span);
                if is_listening {
                    let opening_paren = self.token_from(span.start).and_then(|it| self.after(it));
                    let parts = [init.map(|it| it.1), test.map(Expr::span), update.map(Expr::span)];
                    for part in parts.into_iter().flatten() {
                        self.set_offsets(part.start, part.end, opening_paren, 1, false);
                    }
                    self.add_blockless_statement_indent(body);
                }
                self.stack.extend(init.map(|it| it.0));
                self.stack.extend(test.map(Step::Expr));
                self.stack.extend(update.map(Step::Expr));
                self.stack.push(in_body(body));
                self.stack.extend(is_listening.then_some(Step::ExitStmt(statement)));
            }
            StmtKind::ForIn { left, expr, body } | StmtKind::ForOf { left, expr, body, .. } => {
                let node_type = match statement.tag() {
                    StmtTag::ForIn => "ForInStatement",
                    _ => "ForOfStatement",
                };
                let is_listening = self.enter(node_type, span);
                if is_listening {
                    self.add_blockless_statement_indent(body);
                }
                self.stack.push(head(left, true).0);
                self.stack.push(Step::Expr(expr));
                self.stack.push(in_body(body));
                self.stack.extend(is_listening.then_some(Step::ExitStmt(statement)));
            }
            StmtKind::While { test: head, body } | StmtKind::With { object: head, body } => {
                let node_type = match statement.tag() {
                    StmtTag::While => "WhileStatement",
                    _ => "WithStatement",
                };
                let is_listening = self.enter(node_type, span);
                if is_listening {
                    self.add_blockless_statement_indent(body);
                }
                self.stack.push(Step::Expr(head));
                self.stack.push(in_body(body));
                self.stack.extend(is_listening.then_some(Step::ExitStmt(statement)));
            }
            StmtKind::DoWhile { body, test } => {
                let is_listening = self.enter("DoWhileStatement", span);
                if is_listening {
                    self.add_blockless_statement_indent(body);
                }
                self.stack.push(in_body(body));
                self.stack.push(Step::Expr(test));
                self.stack.extend(is_listening.then_some(Step::ExitStmt(statement)));
            }
            StmtKind::Block(statements) => {
                if self.enter("BlockStatement", span) {
                    let elements = statements.iter().map(|it| Some(statement_span(it)));
                    self.block(span, parent, elements, Offset::Levels(1));
                }
                self.stack.extend(statements.iter().map(Step::Stmt));
            }
            StmtKind::Switch { expr, cases } => {
                if self.enter("SwitchStatement", span) {
                    self.switch_statement(span, expr, cases);
                }
                self.stack.push(Step::Expr(expr));
                self.stack.extend(cases.iter().map(Step::Case));
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                self.enter("TryStatement", span);
                self.stack.push(in_body(block));
                self.stack.extend(handler.map(|_| Step::CatchClause(statement)));
                self.stack.extend(finalizer.map(in_body));
            }
            StmtKind::Break(_) | StmtKind::Continue(_) => {
                let node_type = match statement.tag() {
                    StmtTag::Break => "BreakStatement",
                    _ => "ContinueStatement",
                };
                self.enter(node_type, span);
                if let Some(label) = statement.label() {
                    self.leaf("Identifier", label);
                }
            }
            StmtKind::Labeled { body, .. } => {
                self.enter("LabeledStatement", span);
                if let Some(label) = statement.label() {
                    self.leaf("Identifier", label);
                }
                self.stack.push(in_body(body));
            }
            StmtKind::Import(import) => {
                if self.enter("ImportDeclaration", span) {
                    self.import_declaration(span, import);
                }
                if let Some(default) = import.default() {
                    self.leaf("ImportDefaultSpecifier", default);
                    self.leaf("Identifier", default);
                }
                if let (Some(specifier), Some(namespace)) = (import.namespace_span(), import.namespace()) {
                    self.stack.push(Step::Enter("ImportNamespaceSpecifier", specifier));
                    self.leaf("Identifier", namespace);
                }
                for specifier in import.named() {
                    self.stack.push(Step::Enter("ImportSpecifier", specifier.span()));
                    self.module_export_name(specifier.imported());
                    self.leaf("Identifier", specifier.local());
                }
                self.module_source(statement);
            }
            StmtKind::ExportNamed(export) => {
                if self.enter("ExportNamedDeclaration", span) {
                    self.export_named_declaration(span, export);
                }
                for specifier in export.items() {
                    self.stack.push(Step::Enter("ExportSpecifier", specifier.span()));
                    self.module_export_name(specifier.local());
                    self.module_export_name(specifier.exported());
                }
                self.module_source(statement);
            }
            StmtKind::ExportStar { alias, .. } => {
                self.enter("ExportAllDeclaration", span);
                if let Some(alias) = alias {
                    self.module_export_name(alias);
                }
                self.module_source(statement);
            }
            StmtKind::ExportDefault(e) => {
                self.enter("ExportDefaultDeclaration", span);
                self.stack.push(Step::Expr(e));
            }
            StmtKind::ExportAssign(e) => {
                self.unknown("TSExportAssignment", span, |it| it.stack.push(Step::Expr(e)));
            }
            StmtKind::ExportAsNamespace(_) => self.unknown("TSNamespaceExportDeclaration", span, |it| {
                if let Some(name) = statement.namespace_export_name() {
                    it.leaf("Identifier", name);
                }
            }),
            StmtKind::ImportEquals(import) => self.unknown("TSImportEqualsDeclaration", span, |it| {
                it.leaf("Identifier", import.name());
                match (import.target(), import.require_span()) {
                    (ImportEqualsTarget::Entity(name), _) => it.entity_name(name, false),
                    (_, Some(reference)) => it.unknown("TSExternalModuleReference", reference, |it| {
                        if let Some(source) = statement.module_specifier_span() {
                            it.leaf("Literal", source);
                        }
                    }),
                    _ => {}
                }
            }),
            StmtKind::Interface(interface) => self.unknown("TSInterfaceDeclaration", span, |it| {
                it.leaf("Identifier", interface.name());
                it.type_parameters(interface.type_params());
                for ty in interface.extends() {
                    it.heritage("TSInterfaceHeritage", ty);
                }
                it.unknown("TSInterfaceBody", interface.body_span(), |it| {
                    it.stack.extend(interface.members().iter().map(Step::Member));
                });
            }),
            StmtKind::TypeAlias(alias) => self.unknown("TSTypeAliasDeclaration", span, |it| {
                it.leaf("Identifier", alias.name());
                it.type_parameters(alias.type_params());
                it.stack.push(Step::Type(alias.ty()));
            }),
            StmtKind::Enum(declaration) => self.unknown("TSEnumDeclaration", span, |it| {
                it.leaf("Identifier", declaration.name());
                it.unknown("TSEnumBody", declaration.body_span(), |it| {
                    it.stack.extend(declaration.members().iter().map(Step::EnumMember));
                });
            }),
            StmtKind::Module(module) => self.unknown("TSModuleDeclaration", span, |it| {
                match module.name() {
                    ModuleName::String(name) => it.leaf("Literal", name),
                    _ => {
                        let nested = std::iter::successors(Some(module), |it| it.nested());
                        let names: SmallVec<[Span; 4]> = nested.map(Module::name_span).collect();
                        it.qualified_name(&names, false);
                    }
                }
                let innermost = module.innermost();
                if let Some(block) = innermost.body_span() {
                    it.unknown("TSModuleBlock", block, |it| {
                        it.stack.extend(innermost.body().iter().map(|body| Step::Body(body, block.start)));
                    });
                }
            }),
        }
    }

    /// The listener for `BlockStatement, ClassBody`.
    fn block(
        &mut self,
        node: Span,
        parent: Option<u32>,
        elements: impl Iterator<Item = Option<Span>>,
        level: Offset,
    ) -> Option<()> {
        let (first, last) = (self.token_from(node.start)?, self.token_until(node.end)?);
        if let Some(parent) = parent {
            self.set_offset(first, self.token_from(parent), 0);
        }
        self.add_element_list_indent(elements, first, last, level);
        Some(())
    }

    /// With semicolon-first style, the `;` that ends the body is not indented.
    fn exit_statement(&mut self, statement: Stmt<'a>) {
        let bodies = match statement.kind() {
            StmtKind::If { yes, no, .. } => [Some(yes), no],
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::With { body, .. } => [Some(body), None],
            _ => [None, None],
        };
        let first = self.token_from(statement.span().start);
        for body in bodies.into_iter().flatten() {
            if let Some(last) = self.token_until(body.span().end)
                && self.is_punctuator(last, b";")
                && let (Some(before), Some(after)) = (self.before(last), self.after(last))
                && self.token(before).end_line != self.token(last).line
                && self.token(last).end_line == self.token(after).line
            {
                self.set_offset(last, first, 0);
            }
        }
    }

    fn catch_clause(&mut self, statement: Stmt<'a>) {
        let StmtKind::Try {
            param,
            handler: Some(handler),
            ..
        } = statement.kind()
        else {
            return;
        };
        let Some(span) = statement.catch_clause_span() else {
            return;
        };
        self.enter("CatchClause", span);
        self.stack.extend(param.map(Step::VarPat));
        self.stack.push(Step::Body(handler, span.start));
    }

    fn switch_statement(&mut self, node: Span, discriminant: Expr<'a>, cases: List<'a, Case<'a>>) -> Option<()> {
        let opening = self.punctuator_from(discriminant.span().end, b"{")?;
        let closing = self.token_until(node.end)?;
        let (start, end) = (self.token(opening).end, self.token(closing).start);
        self.set_offsets(start, end, Some(opening), self.rule.switch_case, false);
        if let Some(last) = cases.last() {
            for comment in self.lower_bound(last.span().end)..closing {
                self.ignore_token(comment);
            }
        }
        Some(())
    }

    fn switch_case(&mut self, case: Case<'a>) {
        let (span, body) = (case.span(), case.body());
        let is_block = body.len() == 1 && body.first().is_some_and(|it| matches!(it.kind(), StmtKind::Block(_)));
        if self.enter("SwitchCase", span)
            && !is_block
            && let (Some(keyword), Some(after)) = (self.token_from(span.start), self.token_from(span.end))
        {
            self.set_offsets(self.token(keyword).end, self.token(after).start, Some(keyword), 1, false);
        }
        self.stack.extend(case.test().map(Step::Expr));
        self.stack.extend(body.iter().map(Step::Stmt));
    }

    fn variable_declaration(&mut self, node: Span, declarations: List<'a, VarDecl<'a>>) -> Option<()> {
        let [var, let_, const_] = self.rule.variable_declarator;
        let offset = match declarations.first()?.var_kind() {
            VarKind::Var => var,
            VarKind::Let => let_,
            VarKind::Const => const_,
            _ => Offset::Levels(1),
        };
        let (first, last) = (self.token_from(node.start)?, self.token_until(node.end)?);
        if offset == Offset::First && declarations.len() > 1 {
            let elements = declarations.iter().map(|it| Some(it.span()));
            self.add_element_list_indent(elements, first, last, Offset::First);
            return Some(());
        }
        let levels = match offset {
            Offset::Levels(levels) => levels,
            Offset::First => 1,
            // Upstream multiplies the word by the size of a level.
            Offset::Off => 0,
        };
        // The declarator that starts on the line of the keyword is indented like those that follow.
        let last_declaration = self.token_from(declarations.last()?.span().start)?;
        let is_forced = self.token(last_declaration).line > self.token(first).line;
        self.set_offsets(node.start, node.end, Some(first), levels, is_forced);
        if self.is_punctuator(last, b";") {
            self.ignore_token(last);
        }
        Some(())
    }

    fn variable_declarator(&mut self, declaration: VarDecl<'a>) {
        let span = declaration.span();
        if self.enter("VariableDeclarator", span)
            && let Some(init) = declaration.init()
            && let Some(operator) = self.token_before_parens(init.span().start)
            && let Some(after) = self.after(operator)
        {
            self.ignore_token(operator);
            self.ignore_token(after);
            self.set_offsets(self.token(after).start, span.end, Some(operator), 1, false);
            self.set_offset(operator, self.token_until(declaration.binding_span().end), 0);
        }
        self.stack.push(Step::VarPat(declaration));
        self.stack.extend(declaration.init().map(Step::Expr));
    }

    fn import_declaration(&mut self, node: Span, import: Import<'a>) -> Option<()> {
        let (first, last) = (self.token_from(node.start)?, self.token_until(node.end)?);
        if !import.named().is_empty() {
            let opening = self.punctuator_from(node.start, b"{")?;
            let closing = self.punctuator_until(node.end, b"}")?;
            let elements = import.named().iter().map(|it| Some(it.span()));
            self.add_element_list_indent(elements, opening, closing, self.rule.import_declaration);
        }
        let in_node = || (first..=last).rev();
        let from = in_node().find(|&it| self.token(it).kind == TokenKind::Identifier && self.text_of(it) == b"from")?;
        let source = in_node().find(|&it| self.token(it).kind == TokenKind::String)?;
        self.set_offsets(self.token(from).start, self.token(source).end, Some(first), 1, false);
        Some(())
    }

    fn export_named_declaration(&mut self, node: Span, export: Export<'a>) -> Option<()> {
        let first = self.token_from(node.start)?;
        let closing = self.punctuator_until(node.end, b"}")?;
        let elements = export.items().iter().map(|it| Some(it.span()));
        self.add_element_list_indent(elements, self.after(first)?, closing, Offset::Levels(1));
        if export.has_from() {
            self.set_offsets(self.token(closing).end, node.end, Some(first), 1, false);
        }
        Some(())
    }

    /// A name in the braces of an import or an export, which can be written as a string.
    fn module_export_name(&mut self, name: Ident<'a>) {
        self.leaf(if name.is_string() { "Literal" } else { "Identifier" }, name);
    }

    /// The `source` and the `attributes` of an import or an export.
    fn module_source(&mut self, statement: Stmt<'a>) {
        if self.is_matching()
            && let Some(source) = statement.module_specifier_span()
        {
            self.leaf("Literal", source);
        }
        let Some(attributes) = statement.import_attributes() else {
            return;
        };
        for attribute in attributes.entries() {
            self.unknown("ImportAttribute", attribute.span(), |it| {
                if let Some(key) = attribute.key() {
                    it.key(key);
                }
                if let Some(value) = attribute.value() {
                    it.leaf("Literal", value);
                }
            });
        }
    }
}

// ───────────────────────────── functions and classes ─────────────────────────────

impl<'a> Offsets<'a, '_> {
    fn function(&mut self, func: Func<'a>) {
        let (span, kind) = (func.estree_span(), func.kind());
        if !func.has_body() {
            let node_type = match kind {
                FnKind::Decl => "TSDeclareFunction",
                _ => "TSEmptyBodyFunctionExpression",
            };
            return self.unknown(node_type, span, |it| it.signature(func));
        }
        match kind {
            FnKind::Arrow => {
                if self.enter("ArrowFunctionExpression", span) {
                    self.arrow_function(func, span);
                }
            }
            FnKind::Decl => {
                if self.enter("FunctionDeclaration", span) {
                    self.function_parameters(func, self.rule.function_declaration.parameters);
                }
            }
            _ => {
                if self.enter("FunctionExpression", span) {
                    self.function_parameters(func, self.rule.function_expression.parameters);
                }
            }
        }
        self.signature(func);
        self.stack.push(match func.body() {
            FnBody::Expr(e) => Step::Expr(e),
            _ => Step::FuncBody(func),
        });
    }

    /// The name, the type parameters, the parameters and the return type.
    fn signature(&mut self, func: Func<'a>) {
        if let Some(name) = func.name() {
            self.leaf("Identifier", name);
        }
        self.type_parameters(func.type_params());
        self.stack.extend(func.params_with_this().map(Step::Param));
        if let Some(ty) = func.return_type() {
            self.type_annotation(ty);
        }
    }

    /// The listener for `FunctionDeclaration, FunctionExpression`.
    fn function_parameters(&mut self, func: Func<'a>, offset: Offset) -> Option<()> {
        let closing = self.token_until(func.body_span()?.start)?;
        let opening = match func.params_with_this().next() {
            Some(first) => self.token_until(parameter_span(first).start)?,
            None => self.before(closing)?,
        };
        self.add_parameter_parens(opening, closing);
        let elements = func.params_with_this().map(|it| Some(parameter_span(it)));
        self.add_element_list_indent(elements, opening, closing, offset);
        Some(())
    }

    fn arrow_function(&mut self, func: Func<'a>, node: Span) -> Option<()> {
        let (body, is_block) = match func.body() {
            FnBody::Expr(e) => (e.span(), false),
            _ => (func.body_span()?, true),
        };
        let mut opening = self.token_from(node.start)?;
        if func.is_async() {
            opening = self.after(opening)?;
        }
        if self.is_punctuator(opening, b"(") {
            let closing = self.punctuator_until(body.start, b")")?;
            self.add_parameter_parens(opening, closing);
            let elements = func.params_with_this().map(|it| Some(parameter_span(it)));
            self.add_element_list_indent(elements, opening, closing, self.rule.function_expression.parameters);
        }
        if !is_block {
            self.add_blockless_node_indent(body);
        }
        Some(())
    }

    fn function_body(&mut self, func: Func<'a>) {
        let (Some(span), Some(statements)) = (func.body_span(), func.body_statements()) else {
            return;
        };
        if self.enter("BlockStatement", span) {
            let level = match func.owner() {
                Node::Expr(e) if is_outer_iife(e) => self.rule.outer_iife_body,
                _ if func.kind() == FnKind::Decl => Offset::Levels(self.rule.function_declaration.body),
                _ => Offset::Levels(self.rule.function_expression.body),
            };
            let elements = statements.iter().map(|it| Some(statement_span(it)));
            self.block(span, Some(func.estree_span().start), elements, level);
        }
        self.stack.extend(statements.iter().map(Step::Stmt));
    }

    fn parameter(&mut self, param: Param<'a>) {
        if !has_keywords(param) {
            return self.inner_parameter(param, true);
        }
        self.unknown("TSParameterProperty", param.span(), |it| {
            it.decorators(param.modifiers());
            it.stack.push(Step::InnerParam(param));
        });
    }

    /// `is_outermost`: it is not in a `TSParameterProperty`, which has the decorators then.
    fn inner_parameter(&mut self, param: Param<'a>, is_outermost: bool) {
        let decorators = is_outermost.then(|| param.modifiers());
        if param.is_rest() {
            self.enter("RestElement", param.span());
            self.decorators_of(decorators);
            self.stack.push(Step::Pat(param.pat()));
            if let Some(ty) = param.ty() {
                self.type_annotation(ty);
            }
        } else if let Some(default) = param.default() {
            self.enter("AssignmentPattern", Span::new(param.pat().span().start, default.outer_span().end));
            self.decorators_of(decorators);
            self.stack.push(Step::ParamPat(param));
            self.stack.push(Step::Expr(default));
        } else {
            self.pattern(param.pat(), param.binding_span(), param.ty(), decorators);
        }
    }

    /// `span`: with the `?` and the type annotation `ty`, which ESLint has as parts of the pattern.
    fn pattern(
        &mut self,
        pat: Pat<'a>,
        span: Span,
        ty: Option<TypeNode<'a>>,
        decorators: Option<List<'a, Modifier<'a>>>,
    ) {
        match pat.kind() {
            PatKind::Missing => return,
            PatKind::Ident(_) => {
                match span == pat.span() {
                    true => self.leaf("Identifier", span),
                    false => _ = self.enter("Identifier", span),
                }
                self.decorators_of(decorators);
            }
            PatKind::Object(properties) => {
                if self.enter("ObjectPattern", span) {
                    let elements = properties.iter().map(|it| Some(it.span()));
                    self.brackets(pat.span(), elements, self.rule.object_expression);
                }
                self.decorators_of(decorators);
                self.stack.extend(properties.iter().map(Step::PatProp));
            }
            PatKind::Array(elements) => {
                if self.enter("ArrayPattern", span) {
                    let elements = elements.iter().map(|it| it.pat().map(|_| it.span()));
                    self.brackets(pat.span(), elements, self.rule.array_expression);
                }
                self.decorators_of(decorators);
                self.stack.extend(elements.iter().map(Step::PatElem));
            }
        }
        if let Some(ty) = ty {
            self.type_annotation(ty);
        }
    }

    /// The listeners for arrays and objects. `node`: from the opening to the closing bracket.
    fn brackets(&mut self, node: Span, elements: impl Iterator<Item = Option<Span>>, offset: Offset) -> Option<()> {
        let (opening, closing) = (self.token_from(node.start)?, self.token_until(node.end)?);
        self.add_element_list_indent(elements, opening, closing, offset);
        Some(())
    }

    fn pattern_property(&mut self, prop: PatProp<'a>) {
        if prop.is_rest() {
            self.enter("RestElement", prop.span());
            return self.stack.push(Step::Pat(prop.value()));
        }
        let is_listening = self.enter("Property", prop.span());
        let Some(key) = prop.key() else {
            return;
        };
        if is_listening && !prop.is_shorthand() {
            self.property_value(key);
        }
        self.key(key);
        self.stack.push(match prop.default() {
            Some(_) => Step::PatPropValue(prop),
            None => Step::Pat(prop.value()),
        });
    }

    /// The listener for `Property`: what follows the colon is not checked.
    fn property_value(&mut self, key: Key<'a>) -> Option<()> {
        let colon = self.punctuator_from(key.inner_span(self.file).end, b":")?;
        self.ignore_token(self.after(colon)?);
        Some(())
    }

    fn pattern_element(&mut self, element: PatElem<'a>) {
        let Some(pat) = element.pat() else {
            return;
        };
        match element.default() {
            Some(default) => {
                self.enter("AssignmentPattern", element.span());
                self.stack.push(Step::Pat(pat));
                self.stack.push(Step::Expr(default));
            }
            None if element.is_rest() => {
                self.enter("RestElement", element.span());
                self.stack.push(Step::Pat(pat));
            }
            None => self.pattern(pat, pat.span(), None, None),
        }
    }

    /// The name of a property or a member.
    fn key(&mut self, key: Key<'a>) {
        if let KeyKind::Computed(e) = key.kind() {
            return self.stack.push(Step::Expr(e));
        }
        if !self.is_matching() {
            return;
        }
        let span = key.inner_span(self.file);
        match key.kind() {
            KeyKind::Ident(_) => self.leaf("Identifier", span),
            KeyKind::Private(_) => self.leaf("PrivateIdentifier", span),
            KeyKind::ComputedString(_) if self.file.slice(span).starts_with(b"`") => {
                self.leaf("TemplateLiteral", span);
                self.leaf("TemplateElement", span);
            }
            _ => self.leaf("Literal", span),
        }
    }

    fn class(&mut self, class: Class<'a>, node_type: &'static str) {
        let span = class.estree_span();
        if self.enter(node_type, span)
            && let Some(superclass) = class.extends()
            && let Some(extends) = self.token_before_parens(superclass.span().start)
        {
            let keyword = self.token_from(span.start);
            self.set_offsets(self.token(extends).start, class.body_span().start, keyword, 1, false);
        }
        self.decorators(class.modifiers());
        if let Some(name) = class.name() {
            self.leaf("Identifier", name);
        }
        self.type_parameters(class.type_params());
        self.stack.extend(class.extends().map(Step::Expr));
        self.type_arguments(class.extends_args());
        for ty in class.implements() {
            self.heritage("TSClassImplements", ty);
        }
        self.stack.push(Step::ClassBody(class));
    }

    fn class_body(&mut self, class: Class<'a>) {
        let span = class.body_span();
        if self.enter("ClassBody", span) {
            let level = match class.owner() {
                Node::Expr(e) if is_outer_iife(e) => self.rule.outer_iife_body,
                _ => Offset::Levels(1),
            };
            let elements = class.members().iter().map(|it| Some(it.span()));
            self.block(span, Some(class.estree_span().start), elements, level);
        }
        self.stack.extend(class.members().iter().map(Step::Member));
    }

    /// A member of a class, an interface or a type literal.
    fn member(&mut self, member: Member<'a>) {
        let span = member.span();
        let keywords = member.modifiers().iter().fold(Flags::empty(), |all, it| all | it.flag());
        let is_abstract = keywords.contains(Flags::ABSTRACT);
        // The decorators, the key and the type annotation.
        let head = |it: &mut Self, has_decorators: bool| {
            if has_decorators {
                it.decorators(member.modifiers());
            }
            match (member.key(), member.constructor_keyword()) {
                (Some(key), _) => it.key(key),
                (None, Some(keyword)) => it.module_export_name(keyword),
                (None, None) => {}
            }
            if let Some(ty) = member.ty() {
                it.type_annotation(ty);
            }
        };
        let signature = |it: &mut Self| {
            if let Some(func) = member.func() {
                it.signature(func);
            }
        };
        match member.kind() {
            MemberKind::StaticBlock => {
                let Some(statements) = member.func().and_then(Func::body_statements) else {
                    return;
                };
                if self.enter("StaticBlock", span)
                    && let Some(opening) = self.token_from(span.start).and_then(|it| self.after(it))
                    && let Some(closing) = self.token_until(span.end)
                {
                    let elements = statements.iter().map(|it| Some(statement_span(it)));
                    let level = Offset::Levels(self.rule.static_block_body);
                    self.add_element_list_indent(elements, opening, closing, level);
                }
                self.stack.extend(statements.iter().map(Step::Stmt));
            }
            MemberKind::CallSignature => self.unknown("TSCallSignatureDeclaration", span, signature),
            MemberKind::ConstructSignature => self.unknown("TSConstructSignatureDeclaration", span, signature),
            MemberKind::IndexSignature => self.unknown("TSIndexSignature", span, signature),
            MemberKind::Property if member.is_signature() => {
                self.unknown("TSPropertySignature", span, |it| head(it, false));
            }
            _ if member.is_signature() => self.unknown("TSMethodSignature", span, |it| {
                head(it, false);
                signature(it);
            }),
            MemberKind::Property => {
                let value = member.init().map(Step::Expr);
                match (keywords.contains(Flags::ACCESSOR), is_abstract) {
                    (true, true) => self.unknown("TSAbstractAccessorProperty", span, |it| head(it, true)),
                    (false, true) => self.unknown("TSAbstractPropertyDefinition", span, |it| head(it, true)),
                    (true, false) => self.unknown("AccessorProperty", span, |it| {
                        head(it, true);
                        it.stack.extend(value);
                    }),
                    (false, false) => {
                        if self.enter("PropertyDefinition", span) {
                            self.property_definition(member, span);
                        }
                        head(self, true);
                        self.stack.extend(value);
                    }
                }
            }
            _ if is_abstract => self.unknown("TSAbstractMethodDefinition", span, |it| {
                head(it, false);
                it.stack.extend(member.func().map(Step::Func));
            }),
            kind => {
                self.enter("MethodDefinition", span);
                head(self, kind != MemberKind::Constructor);
                self.stack.extend(member.func().map(Step::Func));
            }
        }
    }

    fn property_definition(&mut self, member: Member<'a>, node: Span) -> Option<()> {
        let key = member.key()?;
        let key_span = key.inner_span(self.file);
        let (first, last) = (self.token_from(node.start)?, self.token_until(node.end)?);
        let last_of_key = if key.is_computed() {
            let left = self.punctuator_until(key_span.start, b"[")?;
            let right = self.punctuator_from(key_span.end, b"]")?;
            self.set_offset(left, Some(first), 0);
            self.set_offsets(self.token(left).end, self.token(right).start, Some(left), 1, false);
            self.set_offset(right, Some(left), 0);
            right
        } else {
            let name = self.token_from(key_span.start)?;
            self.set_offset(name, Some(first), 1);
            name
        };
        let semicolon = self.is_punctuator(last, b";").then_some(last);
        let mut before_semicolon = last_of_key;
        if let Some(value) = member.init() {
            let equals = self.punctuator_until(value.span().start, b"=")?;
            self.set_offset(equals, Some(last_of_key), 1);
            self.set_offset(self.after(equals)?, Some(equals), 1);
            before_semicolon = equals;
        }
        if let Some(semicolon) = semicolon {
            self.set_offset(semicolon, Some(before_semicolon), 1);
        }
        Some(())
    }
}

// ───────────────────────────── expressions ─────────────────────────────

impl<'a> Offsets<'a, '_> {
    fn expression(&mut self, e: Expr<'a>) {
        let span = e.span();
        match e.kind() {
            ExprKind::Missing => {}
            ExprKind::Ident(_) => self.leaf("Identifier", span),
            ExprKind::PrivateIdentifier(_) => self.leaf("PrivateIdentifier", span),
            ExprKind::This => self.leaf("ThisExpression", span),
            ExprKind::Super => self.leaf("Super", span),
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_) => self.leaf("Literal", span),
            ExprKind::Template(template) => {
                if self.enter("TemplateLiteral", span) {
                    self.template_literal(span, template);
                }
                if self.is_matching() {
                    for i in 0..template.quasi_count() {
                        self.leaf("TemplateElement", template.quasi_span(i));
                    }
                }
                self.stack.extend(template.exprs().iter().map(Step::Expr));
            }
            ExprKind::TaggedTemplate(call) => {
                self.enter("TaggedTemplateExpression", span);
                self.stack.push(Step::Expr(call.callee()));
                self.type_arguments(call.type_args());
                self.stack.extend(call.template().map(Step::Expr));
            }
            ExprKind::Array(elements) => self.array(e, elements, "ArrayExpression", Step::Expr),
            ExprKind::Object(properties) => self.object(e, properties, "ObjectExpression", Step::Prop),
            ExprKind::Fn(func) => self.function(func),
            ExprKind::Class(class) => self.class(class, "ClassExpression"),
            ExprKind::Dot { obj, name, .. } => {
                self.chain_expression(e);
                if self.enter("MemberExpression", span) {
                    self.member_expression(obj.span(), name.span(), false, span.end);
                }
                self.stack.push(Step::Expr(obj));
                let is_private = name.bytes().starts_with(b"#");
                self.leaf(if is_private { "PrivateIdentifier" } else { "Identifier" }, name);
            }
            ExprKind::Index { obj, index, .. } => {
                self.chain_expression(e);
                if self.enter("MemberExpression", span) {
                    self.member_expression(obj.span(), index.span(), true, span.end);
                }
                self.stack.push(Step::Expr(obj));
                self.stack.push(Step::Expr(index));
            }
            ExprKind::ImportMeta | ExprKind::NewTarget => {
                let Some((meta, property)) = e.meta_property_spans() else {
                    return;
                };
                if self.enter("MetaProperty", span) {
                    self.member_expression(meta, property, false, span.end);
                }
                self.leaf("Identifier", meta);
                self.leaf("Identifier", property);
            }
            ExprKind::Call(call) => {
                self.chain_expression(e);
                if self.enter("CallExpression", span) {
                    self.add_function_call_indent(span, call);
                }
                self.call_children(call);
            }
            ExprKind::New(call) => {
                // Not for `new Foo`.
                if self.enter("NewExpression", span)
                    && (!call.args().is_empty()
                        || self.token_until(span.end).is_some_and(|last| {
                            self.is_punctuator(last, b")")
                                && self.before(last).is_some_and(|it| self.is_punctuator(it, b"("))
                        }))
                {
                    self.add_function_call_indent(span, call);
                }
                self.call_children(call);
            }
            ExprKind::ImportCall { args } => {
                if self.enter("ImportExpression", span) {
                    self.import_expression(span, args.first());
                }
                self.stack.extend(args.iter().map(Step::Expr));
            }
            ExprKind::Unary { op, operand } => {
                let node_type = match op {
                    UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => "UpdateExpression",
                    _ => "UnaryExpression",
                };
                self.enter(node_type, span);
                self.stack.push(Step::Expr(operand));
            }
            ExprKind::Binary { op: BinOp::Comma, .. } => {
                self.enter("SequenceExpression", span);
                self.stack.extend(e.sequence().into_iter().map(Step::Expr));
            }
            ExprKind::Binary { op, left, right } => {
                let node_type = match op {
                    BinOp::And | BinOp::Or | BinOp::Nullish => "LogicalExpression",
                    _ => "BinaryExpression",
                };
                // The operands are not checked.
                if self.enter(node_type, span)
                    && let Some(operator) = self.token_after_parens(left.span().end)
                    && let Some(after) = self.after(operator)
                {
                    self.ignore_token(operator);
                    self.ignore_token(after);
                    self.set_offset(after, Some(operator), 0);
                }
                self.stack.push(Step::Expr(left));
                self.stack.push(Step::Expr(right));
            }
            ExprKind::Assign { target, value, .. } => {
                if self.enter("AssignmentExpression", span)
                    && let Some(operator) = self.token_after_parens(target.span().end)
                {
                    let last_of_target = self.token_until(target.span().end);
                    self.set_offsets(self.token(operator).start, span.end, last_of_target, 1, false);
                    self.ignore_token(operator);
                    if let Some(after) = self.after(operator) {
                        self.ignore_token(after);
                    }
                }
                self.stack.push(Step::Target(target));
                self.stack.push(Step::Expr(value));
            }
            ExprKind::Cond { test, yes, no } => {
                if self.enter("ConditionalExpression", span) {
                    self.conditional_expression(e, test.span(), yes.span());
                }
                self.stack.extend([test, yes, no].map(Step::Expr));
            }
            ExprKind::Spread(argument) => {
                self.enter("SpreadElement", span);
                self.stack.push(Step::Expr(argument));
            }
            ExprKind::Await(argument) => {
                self.enter("AwaitExpression", span);
                self.stack.push(Step::Expr(argument));
            }
            ExprKind::Yield { value, .. } => {
                self.enter("YieldExpression", span);
                self.stack.extend(value.map(Step::Expr));
            }
            ExprKind::Jsx(jsx) => self.jsx(e, jsx),
            ExprKind::As { expr, ty } if e.is_angle_bracket_assertion() => {
                self.unknown("TSTypeAssertion", span, |it| it.stack.extend([Step::Type(ty), Step::Expr(expr)]));
            }
            ExprKind::As { expr, ty } => {
                self.unknown("TSAsExpression", span, |it| it.stack.extend([Step::Expr(expr), Step::Type(ty)]));
            }
            ExprKind::Satisfies { expr, ty } => {
                self.unknown("TSSatisfiesExpression", span, |it| it.stack.extend([Step::Expr(expr), Step::Type(ty)]));
            }
            ExprKind::AsConst(expr) => {
                let is_angle_bracket = e.is_angle_bracket_assertion();
                let node_type = if is_angle_bracket { "TSTypeAssertion" } else { "TSAsExpression" };
                self.unknown(node_type, span, |it| {
                    if !is_angle_bracket {
                        it.stack.push(Step::Expr(expr));
                    }
                    if let Some(keyword) = e.const_keyword_span() {
                        it.unknown("TSTypeReference", keyword, |it| it.leaf("Identifier", keyword));
                    }
                    if is_angle_bracket {
                        it.stack.push(Step::Expr(expr));
                    }
                });
            }
            ExprKind::NonNull(expr) => {
                self.chain_expression(e);
                self.unknown("TSNonNullExpression", span, |it| it.stack.push(Step::Expr(expr)));
            }
            ExprKind::Instantiation { expr, type_args } => self.unknown("TSInstantiationExpression", span, |it| {
                it.stack.push(Step::Expr(expr));
                it.type_arguments(type_args);
            }),
        }
    }

    /// What is assigned to: the literals in it are patterns.
    fn target(&mut self, e: Expr<'a>) {
        match e.kind() {
            ExprKind::Array(elements) => self.array(e, elements, "ArrayPattern", Step::Target),
            ExprKind::Object(properties) => self.object(e, properties, "ObjectPattern", Step::TargetProp),
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => {
                self.enter("AssignmentPattern", e.span());
                self.stack.push(Step::Target(target));
                self.stack.push(Step::Expr(value));
            }
            ExprKind::Spread(argument) => {
                self.enter("RestElement", e.span());
                self.stack.push(Step::Target(argument));
            }
            _ => self.expression(e),
        }
    }

    fn array(
        &mut self,
        e: Expr<'a>,
        elements: List<'a, Expr<'a>>,
        node_type: &'static str,
        step: fn(Expr<'a>) -> Step<'a>,
    ) {
        if self.enter(node_type, e.span()) {
            let spans = elements.iter().map(|it| (!it.is_missing()).then(|| it.span()));
            self.brackets(e.span(), spans, self.rule.array_expression);
        }
        self.stack.extend(elements.iter().map(step));
    }

    fn object(
        &mut self,
        e: Expr<'a>,
        properties: List<'a, Prop<'a>>,
        node_type: &'static str,
        step: fn(Prop<'a>) -> Step<'a>,
    ) {
        if self.enter(node_type, e.span()) {
            let spans = properties.iter().map(|it| Some(it.span()));
            self.brackets(e.span(), spans, self.rule.object_expression);
        }
        self.stack.extend(properties.iter().map(step));
    }

    /// A property of an object literal. `is_target`: the object is assigned to.
    fn property(&mut self, prop: Prop<'a>, is_target: bool) {
        let value = |value: Expr<'a>| if is_target { Step::Target(value) } else { Step::Expr(value) };
        let kind = prop.kind();
        if kind == PropKind::Spread {
            self.enter(if is_target { "RestElement" } else { "SpreadElement" }, prop.span());
            return self.stack.extend(prop.value().map(value));
        }
        let is_listening = self.enter("Property", prop.span());
        let Some(key) = prop.key() else {
            return;
        };
        if is_listening && kind == PropKind::Init {
            self.property_value(key);
        }
        self.key(key);
        self.stack.extend(prop.value().map(|it| match kind {
            // `{ a = 1 }`
            PropKind::Shorthand => Step::Target(it),
            _ => value(it),
        }));
    }

    /// ESLint has a `ChainExpression` around the whole of an optional chain.
    fn chain_expression(&mut self, e: Expr<'a>) {
        if e.is_chain_root() {
            self.enter("ChainExpression", e.span());
        }
    }

    fn call_children(&mut self, call: Call<'a>) {
        self.stack.push(Step::Expr(call.callee()));
        self.type_arguments(call.type_args());
        self.stack.extend(call.args().iter().map(Step::Expr));
    }

    /// The token that is `count` tokens before the first of the node that starts at `offset`.
    fn token_before_node(&self, offset: u32, count: usize) -> Option<usize> {
        (0..count).try_fold(self.token_from(offset)?, |token, _| self.before(token))
    }

    /// ESLint's `addFunctionCallIndent`.
    fn add_function_call_indent(&mut self, node: Span, call: Call<'a>) -> Option<()> {
        let callee = call.callee();
        let closing = self.token_until(node.end)?;
        let opening = match call.args().is_empty() {
            true => self.before(closing)?,
            false => self.punctuator_from(callee.span().end, b"(")?,
        };
        self.add_parameter_parens(opening, closing);

        if call.is_optional() {
            let dot = self.punctuator_from(callee.span().end, b"?.")?;
            let after_callee = self.lower_bound(callee.span().end);
            let paren_count = (after_callee..dot).filter(|&it| self.is_punctuator(it, b")")).count();
            let last_of_callee = self.before(dot)?;
            let base = match self.token(last_of_callee).end_line == self.token(opening).line {
                true => last_of_callee,
                false => self.token_before_node(callee.span().start, paren_count)?,
            };
            self.set_offset(dot, Some(base), 1);
        }

        let offset_after = match callee.kind() {
            ExprKind::TaggedTemplate(tagged) => self.token_from(tagged.template()?.span().start)?,
            _ => opening,
        };
        self.set_offset(opening, self.before(offset_after), 0);
        let elements = call.args().iter().map(|it| Some(it.span()));
        self.add_element_list_indent(elements, opening, closing, self.rule.call_arguments);
        Some(())
    }

    fn import_expression(&mut self, node: Span, source: Option<Expr<'a>>) -> Option<()> {
        let opening = self.after(self.token_from(node.start)?)?;
        let closing = self.token_until(node.end)?;
        self.add_parameter_parens(opening, closing);
        self.set_offset(opening, self.before(opening), 0);
        let elements = std::iter::once(Some(source?.span()));
        self.add_element_list_indent(elements, opening, closing, self.rule.call_arguments);
        Some(())
    }

    /// The listener for `MemberExpression, JSXMemberExpression, MetaProperty`.
    fn member_expression(&mut self, object: Span, property: Span, is_computed: bool, end: u32) -> Option<()> {
        let first_non_object = self.token_after_parens(object.end)?;
        let second_non_object = self.after(first_non_object)?;
        let after_object = self.lower_bound(object.end);
        let paren_count = (after_object..first_non_object).filter(|&it| !self.is_comment(it)).count();
        let last_of_object = self.before(first_non_object)?;
        let first_of_property = if is_computed { first_non_object } else { second_non_object };

        if is_computed {
            self.set_offset(self.token_until(end)?, Some(first_non_object), 0);
            self.set_offsets(property.start, property.end, Some(first_non_object), 1, false);
        }

        // A property that starts on the line where the object ends is not indented.
        let base = match self.token(last_of_object).end_line == self.token(first_of_property).line {
            true => last_of_object,
            false => self.token_before_node(object.start, paren_count)?,
        };
        match self.rule.member_expression {
            Some(levels) => {
                self.set_offset(first_non_object, Some(base), levels);
                let from = if is_computed { first_non_object } else { base };
                self.set_offset(second_non_object, Some(from), levels);
            }
            None => {
                self.ignore_token(first_non_object);
                self.ignore_token(second_non_object);
                self.set_offset(first_non_object, Some(base), 0);
                self.set_offset(second_non_object, Some(first_non_object), 0);
            }
        }
        Some(())
    }

    fn template_literal(&mut self, node: Span, template: Template<'a>) -> Option<()> {
        let mut quasi = self.token_from(node.start)?;
        for e in template.exprs() {
            let next = self.token_after_parens(e.span().end)?;
            let previous = self.token(quasi);
            let from = (previous.line == previous.end_line).then_some(quasi);
            self.set_offsets(previous.end, self.token(next).start, from, 1, false);
            self.set_offset(next, from, 0);
            quasi = next;
        }
        Some(())
    }

    /// ESLint's `isOnFirstLineOfStatement`.
    fn is_on_first_line_of_statement(&self, token: usize, e: Expr<'a>) -> bool {
        let statement = Node::Expr(e).ancestors().find_map(|it| match it {
            // The names of these do not end with `Statement` or `Declaration`.
            Node::Stmt(it) if matches!(it.kind(), StmtKind::ExportAssign(_)) => None,
            Node::Stmt(it) if matches!(it.kind(), StmtKind::Fn(func) if !func.has_body()) => None,
            Node::Stmt(it) => Some(it),
            _ => None,
        });
        statement.is_none_or(|it| {
            let start = match export_span(it) {
                Some(_) => it.span_without_export().start,
                None => it.span().start,
            };
            self.file.line_of(start) == self.token(token).line
        })
    }

    fn conditional_expression(&mut self, e: Expr<'a>, test: Span, consequent: Span) -> Option<()> {
        let first = self.token_from(e.span().start)?;
        if self.rule.flat_ternary_expressions
            && self.token(self.token_until(test.end)?).end_line == self.token(self.token_from(consequent.start)?).line
            && !self.is_on_first_line_of_statement(first, e)
        {
            return None;
        }
        let question_mark = self.punctuator_from(test.end, b"?")?;
        let colon = self.punctuator_from(consequent.end, b":")?;
        let first_of_consequent = self.after(question_mark)?;
        let last_of_consequent = self.before(colon)?;
        let first_of_alternate = self.after(colon)?;
        let levels = |offsets: &Self, token: usize| {
            let is_punctuator = offsets.token(token).kind == TokenKind::Punctuator;
            if is_punctuator && offsets.rule.offset_ternary_expressions { 2 } else { 1 }
        };

        self.set_offset(question_mark, Some(first), 1);
        self.set_offset(colon, Some(first), 1);
        self.set_offset(first_of_consequent, Some(first), levels(self, first_of_consequent));

        // If they share a line, the alternate is aligned with the consequent: `) : (`.
        if self.token(last_of_consequent).end_line == self.token(first_of_alternate).line {
            self.set_offset(first_of_alternate, Some(first_of_consequent), 0);
        } else {
            self.set_offset(first_of_alternate, Some(first), levels(self, first_of_alternate));
        }
        Some(())
    }
}

// ───────────────────────────── JSX ─────────────────────────────

impl<'a> Offsets<'a, '_> {
    fn jsx(&mut self, e: Expr<'a>, jsx: Jsx<'a>) {
        let (opening, closing) = (jsx.opening_span(), jsx.closing_span());
        let node_type = if jsx.is_fragment() { "JSXFragment" } else { "JSXElement" };
        if self.enter(node_type, e.span())
            && let Some(closing) = closing
            && let (Some(start), Some(end)) = (self.token_from(opening.start), self.token_from(closing.start))
        {
            let elements = jsx.children_with_whitespace().map(|it| Some(jsx_child_span(it)));
            self.add_element_list_indent(elements, start, end, Offset::Levels(1));
        }
        match jsx.tag() {
            Some(tag) => {
                if self.enter("JSXOpeningElement", opening) {
                    self.jsx_opening_element(jsx, opening, tag.span());
                }
                self.stack.push(Step::JsxName(tag));
                self.type_arguments(jsx.type_args());
                self.stack.extend(jsx.attrs().iter().map(Step::JsxAttribute));
            }
            None => {
                if self.enter("JSXOpeningFragment", opening)
                    && let (Some(first), Some(last)) = (self.token_from(opening.start), self.token_until(opening.end))
                {
                    self.set_offsets(opening.start, opening.end, Some(first), 1, false);
                    self.match_offset_of(first, last);
                }
            }
        }
        for child in jsx.children_with_whitespace() {
            match child {
                JsxChild::Expr(child) => self.stack.push(Step::JsxChild(child)),
                JsxChild::Whitespace(span) => self.leaf("JSXText", span),
            }
        }
        self.stack.extend(closing.map(|_| Step::JsxClosing(e)));
    }

    fn jsx_opening_element(&mut self, jsx: Jsx<'a>, node: Span, name: Span) -> Option<()> {
        let (first, last) = (self.token_from(node.start)?, self.token_until(node.end)?);
        let closing = match jsx.is_self_closing() {
            true => {
                let slash = self.before(last)?;
                self.set_offset(last, Some(slash), 0);
                slash
            }
            false => last,
        };
        self.set_offsets(name.start, name.end, Some(first), 0, false);
        let elements = jsx.attrs().iter().map(|it| Some(it.span()));
        self.add_element_list_indent(elements, first, closing, Offset::Levels(1));
        Some(())
    }

    fn jsx_closing(&mut self, element: Expr<'a>) {
        let ExprKind::Jsx(jsx) = element.kind() else {
            return;
        };
        let Some(span) = jsx.closing_span() else {
            return;
        };
        let first = self.token_from(span.start);
        match jsx.close_tag() {
            Some(tag) => {
                if self.enter("JSXClosingElement", span) {
                    self.set_offsets(tag.span().start, tag.span().end, first, 1, false);
                }
                self.stack.push(Step::JsxName(tag));
            }
            None => {
                if self.enter("JSXClosingFragment", span)
                    && let (Some(first), Some(last)) = (first, self.token_until(span.end))
                    && let Some(slash) = self.before(last)
                {
                    let is_on_same_line = self.token(slash).end_line == self.token(last).line;
                    self.set_offsets(span.start, span.end, Some(first), 1, false);
                    self.match_offset_of(first, if is_on_same_line { slash } else { last });
                }
            }
        }
    }

    /// `a`, `a-b` or `a:b` at `span`.
    fn jsx_identifier(&mut self, span: Span) {
        let Some(colon) = strings::index_of_char_usize(self.file.slice(span), b':') else {
            return self.leaf("JSXIdentifier", span);
        };
        self.stack.push(Step::Enter("JSXNamespacedName", span));
        if self.is_matching() {
            let (text, colon) = (self.file.text(), span.start + colon as u32);
            self.leaf("JSXIdentifier", Span::new(span.start, skip_trivia_back(text, colon)));
            self.leaf("JSXIdentifier", Span::new(skip_trivia(text, colon + 1), span.end));
        }
    }

    /// The name in a tag.
    fn jsx_name(&mut self, name: Expr<'a>) {
        let ExprKind::Dot { obj, name: property, .. } = name.kind() else {
            return self.jsx_identifier(name.span());
        };
        if self.enter("JSXMemberExpression", name.span()) {
            self.member_expression(obj.span(), property.span(), false, name.span().end);
        }
        self.stack.push(Step::JsxName(obj));
        self.leaf("JSXIdentifier", property);
    }

    fn jsx_attribute(&mut self, attribute: Prop<'a>) {
        let (span, value) = (attribute.span(), attribute.value());
        if attribute.kind() == PropKind::Spread {
            if self.enter("JSXSpreadAttribute", span) {
                self.braces(span);
            }
            return self.stack.extend(value.map(Step::Expr));
        }
        let is_listening = self.enter("JSXAttribute", span);
        let Some(name) = attribute.key().map(|it| it.span(self.file)) else {
            return;
        };
        if is_listening
            && let Some(value) = value
            && let Some(equals) = self.punctuator_from(name.end, b"=")
        {
            let end = value.jsx_container_span().unwrap_or_else(|| value.span()).end;
            self.set_offsets(self.token(equals).start, end, self.token_from(name.start), 1, false);
        }
        self.jsx_identifier(name);
        self.stack.extend(value.map(Step::JsxAttributeValue));
    }

    /// The listener for `JSXExpressionContainer` and `JSXSpreadAttribute`.
    fn braces(&mut self, node: Span) -> Option<()> {
        let (opening, closing) = (self.token_from(node.start)?, self.token_until(node.end)?);
        self.set_offsets(self.token(opening).end, self.token(closing).start, Some(opening), 1, false);
        Some(())
    }

    /// A child of an element, or the value of an attribute. `text_type`: what a string is there.
    fn jsx_child(&mut self, child: Expr<'a>, text_type: &'static str) {
        let Some(container) = child.jsx_container_span() else {
            return match child.kind() {
                ExprKind::String(_) => self.leaf(text_type, child),
                _ => self.expression(child),
            };
        };
        if let ExprKind::Spread(argument) = child.kind() {
            return self.unknown("JSXSpreadChild", container, |it| it.stack.push(Step::Expr(argument)));
        }
        if self.enter("JSXExpressionContainer", container) {
            self.braces(container);
        }
        match child.is_missing() {
            true => self.leaf("JSXEmptyExpression", container.shrink(1, 1)),
            false => self.stack.push(Step::Expr(child)),
        }
    }
}

// ───────────────────────────── TypeScript ─────────────────────────────

impl<'a> Offsets<'a, '_> {
    fn decorators(&mut self, modifiers: List<'a, Modifier<'a>>) {
        for modifier in modifiers {
            if let Some(e) = modifier.decorator() {
                self.unknown("Decorator", modifier.span(), |it| it.stack.push(Step::Expr(e)));
            }
        }
    }

    fn decorators_of(&mut self, modifiers: Option<List<'a, Modifier<'a>>>) {
        if let Some(modifiers) = modifiers {
            self.decorators(modifiers);
        }
    }

    /// A node whose children are types.
    fn of_types(&mut self, node_type: &'static str, node: Span, types: impl IntoIterator<Item = TypeNode<'a>>) {
        self.unknown(node_type, node, |it| it.stack.extend(types.into_iter().map(Step::Type)));
    }

    fn type_annotation(&mut self, ty: TypeNode<'a>) {
        self.of_types("TSTypeAnnotation", ty.annotation_span(), [ty]);
    }

    fn type_parameters(&mut self, params: List<'a, TypeParam<'a>>) {
        if let Some(span) = params.angle_brackets_span() {
            self.unknown("TSTypeParameterDeclaration", span, |it| {
                it.stack.extend(params.iter().map(Step::TypeParam));
            });
        }
    }

    fn type_arguments(&mut self, args: List<'a, TypeNode<'a>>) {
        if let Some(span) = args.angle_brackets_span() {
            self.of_types("TSTypeParameterInstantiation", span, args);
        }
    }

    /// An element of `implements`, or of the `extends` of an interface.
    fn heritage(&mut self, node_type: &'static str, ty: TypeNode<'a>) {
        self.unknown(node_type, ty.span(), |it| match ty.kind() {
            TypeKind::Ref { name, args } => {
                it.entity_name(name, true);
                it.type_arguments(args);
            }
            TypeKind::Heritage { expr, args } => {
                it.stack.push(Step::Expr(expr));
                it.type_arguments(args);
            }
            _ => {}
        });
    }

    fn entity_name(&mut self, name: EntityName<'a>, is_member: bool) {
        let names: SmallVec<[Span; 4]> = name.parts().map(Ident::span).collect();
        self.qualified_name(&names, is_member);
    }

    /// `A.B.C`: a `TSQualifiedName`, or in a heritage clause a `MemberExpression`, of `A.B` and `C`.
    fn qualified_name(&mut self, names: &[Span], is_member: bool) {
        let Some((&first, rest)) = names.split_first() else {
            return;
        };
        let mut before = names.iter().rev().skip(1);
        for &name in rest.iter().rev() {
            match (is_member, before.next()) {
                (true, Some(&before)) => self.stack.push(Step::MemberName(first.to(before), name)),
                _ => self.open_unknown("TSQualifiedName", first.to(name)),
            }
        }
        self.leaf("Identifier", first);
        for &name in rest {
            self.leaf("Identifier", name);
            if !is_member {
                self.close_unknown("TSQualifiedName", first.to(name));
            }
        }
    }

    fn tuple_element(&mut self, element: TupleElem<'a>) {
        let span = element.span();
        let inner = move |it: &mut Self| match element.name() {
            Some(name) => it.unknown("TSNamedTupleMember", Span::new(name.span().start, span.end), |it| {
                it.leaf("Identifier", name);
                it.stack.push(Step::Type(element.ty()));
            }),
            None if element.is_optional() => {
                it.of_types("TSOptionalType", span, [element.ty()]);
            }
            None => it.stack.push(Step::Type(element.ty())),
        };
        match element.is_rest() {
            true => self.unknown("TSRestType", span, inner),
            false => inner(self),
        }
    }

    /// What is in a `TSLiteralType`.
    fn literal_type(&mut self, span: Span) {
        let written = self.file.slice(span);
        if written.starts_with(b"-") {
            self.stack.push(Step::Enter("UnaryExpression", span));
            self.leaf("Literal", Span::new(skip_trivia(self.file.text(), span.start + 1), span.end));
        } else if written.starts_with(b"`") {
            self.leaf("TemplateLiteral", span);
            self.leaf("TemplateElement", span);
        } else {
            self.leaf("Literal", span);
        }
    }

    fn type_node(&mut self, ty: TypeNode<'a>) {
        let span = ty.span();
        match ty.kind() {
            TypeKind::Error | TypeKind::Heritage { .. } => self.unknown("TSAnyKeyword", span, |_| {}),
            TypeKind::Keyword(_) => self.unknown(utils::estree_type_name(Node::Type(ty)), span, |_| {}),
            TypeKind::Ref { name, args } => self.unknown("TSTypeReference", span, |it| {
                it.entity_name(name, false);
                it.type_arguments(args);
            }),
            TypeKind::StringLit(_) | TypeKind::NumberLit(_) | TypeKind::BigIntLit { .. } | TypeKind::BoolLit(_) => {
                self.unknown("TSLiteralType", span, |it| it.literal_type(span));
            }
            TypeKind::Template(types) => self.unknown("TSTemplateLiteralType", span, |it| {
                if it.is_matching()
                    && let Some(template) = ty.as_template()
                {
                    for i in 0..template.quasi_count() {
                        it.leaf("TemplateElement", template.quasi_span(i));
                    }
                }
                it.stack.extend(types.iter().map(Step::Type));
            }),
            TypeKind::Array(element) => self.of_types("TSArrayType", span, [element]),
            TypeKind::Tuple(elements) => self.unknown("TSTupleType", span, |it| {
                it.stack.extend(elements.iter().map(Step::TupleElem));
            }),
            TypeKind::Union(types) => self.of_types("TSUnionType", span, types),
            TypeKind::Intersection(types) => self.of_types("TSIntersectionType", span, types),
            TypeKind::Fn(func) => {
                let node_type = match func.kind() {
                    FnKind::ConstructorType => "TSConstructorType",
                    _ => "TSFunctionType",
                };
                self.unknown(node_type, span, |it| it.signature(func));
            }
            TypeKind::Object(members) => self.unknown("TSTypeLiteral", span, |it| {
                it.stack.extend(members.iter().map(Step::Member));
            }),
            TypeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => self.of_types("TSConditionalType", span, [check, extends, yes, no]),
            TypeKind::Infer(param) => self.unknown("TSInferType", span, |it| it.stack.push(Step::TypeParam(param))),
            TypeKind::Mapped(mapped) => self.unknown("TSMappedType", span, |it| {
                it.leaf("Identifier", mapped.param().name());
                let types = [mapped.param().constraint(), mapped.name_type(), mapped.ty()];
                it.stack.extend(types.into_iter().flatten().map(Step::Type));
            }),
            TypeKind::IndexedAccess { obj, index } => self.of_types("TSIndexedAccessType", span, [obj, index]),
            TypeKind::Keyof(operand) | TypeKind::Readonly(operand) => self.of_types("TSTypeOperator", span, [operand]),
            TypeKind::UniqueSymbol => self.unknown("TSTypeOperator", span, |it| {
                if let Some(symbol) = ty.unique_symbol_keyword_span() {
                    it.unknown("TSSymbolKeyword", symbol, |_| {});
                }
            }),
            TypeKind::Typeof { expr, args } => self.unknown("TSTypeQuery", span, |it| {
                it.stack.push(Step::QueryName(expr));
                it.type_arguments(args);
            }),
            TypeKind::Import {
                name, args, is_typeof, ..
            } => {
                let import = move |it: &mut Self| {
                    it.unknown("TSImportType", ty.import_span().unwrap_or(span), |it| {
                        if let Some(source) = ty.import_source_span() {
                            it.leaf("Literal", source);
                        }
                        if let Some(attributes) = ty.import_attributes() {
                            it.import_type_options(attributes);
                        }
                        it.entity_name(name, false);
                        it.type_arguments(args);
                    });
                };
                match is_typeof {
                    true => self.unknown("TSTypeQuery", span, import),
                    false => import(self),
                }
            }
            TypeKind::Predicate { ty: asserted, .. } => self.unknown("TSTypePredicate", span, |it| {
                match ty.predicate_param() {
                    Some(param) if param.name().is("this") => it.unknown("TSThisType", param.span(), |_| {}),
                    Some(param) => it.leaf("Identifier", param),
                    None => {}
                }
                if let Some(asserted) = asserted {
                    it.of_types("TSTypeAnnotation", asserted.span(), [asserted]);
                }
            }),
        }
    }

    /// The `{ with: { .. } }` of an import type: an `ObjectExpression` in another.
    fn import_type_options(&mut self, attributes: ImportAttributes<'a>) {
        let (keyword, braces) = (attributes.keyword_span(), attributes.braces_span());
        self.stack.push(Step::Enter("ObjectExpression", attributes.options_span()));
        self.stack.push(Step::Enter("Property", keyword.to(braces)));
        self.leaf("Identifier", keyword);
        self.stack.push(Step::Enter("ObjectExpression", braces));
        for attribute in attributes.entries() {
            self.stack.push(Step::Enter("Property", attribute.span()));
            if let Some(key) = attribute.key() {
                self.key(key);
            }
            if let Some(value) = attribute.value() {
                self.leaf("Literal", value);
            }
        }
    }
}
