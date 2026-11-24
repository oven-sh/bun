//! Calls, their arguments and member accesses.

use super::function::{ArrowOptions, ExprOptions, FunctionOptions, Grouped, Part};
use super::*;

type Elements = SmallVec<[Option<FormatElement>; 4]>;

impl<'a> Emitter<'a, '_> {
    #[inline]
    pub(super) fn boundary_after_object(&mut self) {
        if !self.is_oxfmt {
            self.boundary();
        }
    }

    pub(super) fn is_call_expression(&self, id: Id) -> bool {
        self.kind(id) == K::Call && (self.is_javascript || !self.is_chain_root(id))
    }

    pub(super) fn is_member_expression(&self, id: Id) -> bool {
        matches!(self.kind(id), K::Dot | K::Index)
            && (self.is_javascript || !self.is_chain_root(id))
    }

    pub(super) fn strip_non_null(&self, mut id: Id) -> Id {
        while self.kind(id) == K::NonNull {
            id = self.node(id).a;
        }
        id
    }

    fn is_function_like(&self, id: Id) -> bool {
        matches!(self.kind(id), K::Fn | K::Arrow)
    }

    fn call_head(&mut self, node: &Node) {
        match self.kind(node.a) {
            K::Call => self.expr_without_shortcut(node.a),
            _ => self.expr(node.a),
        }
        self.boundary_after_object();
        self.token_if(node.has(flag::OPTIONAL), "?.");
        if node.b != NONE {
            self.type_arguments(node.b);
            self.boundary_after_object();
        }
    }

    pub(super) fn call_expression(&mut self, id: Id) {
        let node = self.node(id);
        if self.keeps_arguments_on_one_line(id) {
            self.call_head(node);
            return self.arguments_on_one_line(id);
        }
        if matches!(self.kind(node.a), K::Dot | K::Index)
            && (!self.is_chain_root(node.a)
                || (self.is_javascript && !self.needs_parentheses(node.a)))
        {
            return self.member_chain(id);
        }
        self.group_if(self.is_call_expression(node.a), |e| {
            e.call_head(node);
            e.arguments(id);
        });
    }

    pub(super) fn new_expression(&mut self, id: Id) {
        let node = self.node(id);
        if self.is_template_on_its_own_line_only_argument(id) {
            self.keyword("new");
            self.call_head(node);
            return self.arguments_on_one_line(id);
        }
        self.group_if(self.is_call_expression(node.a), |e| {
            e.keyword("new");
            e.call_head(node);
            e.arguments(id);
        });
    }

    pub(super) fn import_expression(&mut self, id: Id) {
        if self.is_template_on_its_own_line_only_argument(id)
            || (self.is_lone_string(id) && !self.node(id).has(flag::COMMENT))
        {
            self.token("import");
            return self.arguments_on_one_line(id);
        }
        self.group(|e| {
            e.token("import");
            e.arguments(id);
        });
    }

    fn arguments_on_one_line(&mut self, call: Id) {
        self.token("(");
        for (i, &argument) in self.args(call).iter().enumerate() {
            if i > 0 {
                self.keyword(",");
            }
            self.expr(argument);
        }
        self.token(")");
    }

    pub(super) fn is_multiline_template_starting_on_same_line(&self, id: Id) -> bool {
        let node = self.node(id);
        let template = match node.kind {
            K::Template => id,
            K::Tagged => node.c,
            _ => return false,
        };
        let has_newline = |&it: &Id| self.has_newline(self.node(it).start, self.node(it).end);
        node.has(flag::MULTILINE)
            && self.list(template).iter().step_by(2).any(has_newline)
            && !self.source_text().has_line_terminator_before(node.start)
    }

    fn is_template_on_its_own_line_only_argument(&self, call: Id) -> bool {
        matches!(*self.args(call), [only] if self.is_multiline_template_starting_on_same_line(only))
    }

    fn is_lone_string(&self, call: Id) -> bool {
        matches!(*self.args(call), [only] if self.kind(only) == K::Str)
    }

    fn keeps_arguments_on_one_line(&mut self, id: Id) -> bool {
        let (node, args) = (self.node(id), self.args(id));
        let Some(&first) = args.first() else {
            return false;
        };
        let callee = self.node(node.a);
        let first = self.kind(first);
        if callee.kind == K::Ident {
            match self.text_of(node.a) {
                b"require" if node.has(flag::CHAIN) => self.give_up(),
                b"require" if first == K::Str || args.len() > 1 => return true,
                b"define" if self.kind(node.parent) == K::ExprStmt => self.give_up(),
                b"async" | b"inject" | b"fakeAsync" | b"waitForAsync"
                    if self.parent_kind(id) == K::Call =>
                {
                    self.give_up();
                }
                _ => {}
            }
        }
        match (first, args.len()) {
            (K::Template | K::Tagged, 1) => self.is_template_on_its_own_line_only_argument(id),
            (K::Str, 1) => self.is_simple_module_import(node),
            (K::Str | K::Template, 2 | 3) => self.is_test_call(id),
            _ => false,
        }
    }

    fn is_simple_module_import(&self, call: &Node) -> bool {
        let callee = self.node(call.a);
        let object = self.node(callee.a);
        let is_require = |node: &Node| node.kind == K::Ident && node.op == T::Require;
        callee.kind == K::Dot
            && !call.has(flag::CHAIN)
            && match object.kind {
                K::Meta => object.end - object.start == 11 && self.is_name(callee.b, b"resolve"),
                K::Ident => is_require(object) && self.is_name(callee.b, b"resolve"),
                K::Dot => {
                    is_require(self.node(object.a))
                        && self.is_name(object.b, b"resolve")
                        && self.is_name(callee.b, b"paths")
                }
                _ => false,
            }
    }

    /// Angular's wrappers aren't handled: a call of one gives up.
    pub(super) fn is_test_call(&self, id: Id) -> bool {
        let (node, args) = (self.node(id), self.args(id));
        let (first, second, third) = match *args {
            [first, second] => (first, second, NONE),
            [first, second, third] => (first, second, third),
            _ => return false,
        };
        !node.has(flag::OPTIONAL)
            && matches!(self.kind(first), K::Str | K::Template)
            && self.is_function_like(second)
            && (third == NONE
                || (self.kind(third) == K::Num
                    && self.params(second).len() <= 1
                    && self.kind(self.node(second).d) == K::Body))
            && self.is_test_callee(node.a)
            && !(self.is_oxfmt && self.has_comments_around_items(node.c))
    }

    fn is_test_callee(&self, callee: Id) -> bool {
        let mut names = SmallVec::<[&[u8]; 5]>::new();
        let mut current = callee;
        while self.kind(current) == K::Dot && !self.is_chain_root(current) && names.len() < 3 {
            names.insert(0, self.text_of(self.node(current).b));
            current = self.node(current).a;
        }
        if self.kind(current) != K::Ident {
            return false;
        }
        match (self.text_of(current), &names[..]) {
            (b"it" | b"describe", [] | [b"only" | b"skip"])
            | (b"test", [] | [b"only" | b"skip" | b"fixme" | b"step" | b"describe"])
            | (
                b"test",
                [
                    b"describe",
                    b"only" | b"skip" | b"fixme" | b"parallel" | b"serial",
                ],
            )
            | (b"test", [b"describe", b"parallel" | b"serial", b"only"])
            | (b"skip" | b"xit" | b"xdescribe" | b"xtest" | b"fit" | b"fdescribe" | b"ftest", []) => {
                true
            }
            (
                b"it" | b"describe" | b"test",
                [b"skipIf" | b"runIf" | b"concurrent" | b"sequential" | b"todo"],
            )
            | (b"it" | b"test", [b"fails"])
            | (b"describe", [b"shuffle"])
            | (b"test", [b"extend"])
            | (b"bench", [] | [b"only" | b"skip" | b"todo"])
            | (b"Deno", [b"test"]) => self.is_oxfmt,
            _ => false,
        }
    }

    pub(super) fn is_long_curried_call(&self, id: Id) -> bool {
        let (node, count) = (self.node(id), self.args(id).len());
        let parent = self.node(node.parent);
        count > 1
            && parent.kind == K::Call
            && parent.a == id
            && (self.is_javascript || !self.is_chain_root(id))
            && (1..count).contains(&self.list(parent.c).len())
    }

    // ───────────────────────────── arguments ─────────────────────────────

    pub(super) fn arguments(&mut self, call: Id) {
        let list = self.node(call).c;
        match self.node(list).len {
            0 => self.token("()"),
            _ => self.shortcut(list, |e| e.nonempty_arguments(call)),
        }
    }

    fn trailing_comma_after_arguments(&mut self, call: Id) {
        if self.kind(call) != K::ImportCall {
            self.trailing_comma(FormatTrailingCommas::Arguments);
        }
    }

    fn nonempty_arguments(&mut self, call: Id) {
        let args = self.args(call);
        if self.has_comments_around_items(self.node(call).c) {
            return self.arguments_with_comments(call);
        }
        if args.len() > 1 && self.is_react_hook_with_deps_array(args) {
            return self.arguments_on_one_line(call);
        }
        if self.is_flat() {
            if self.is_function_composition(call) {
                return self.not_flat();
            }
            let is_loose = self.kind(call) == K::Call
                && self.is_long_curried_call(call)
                && self.grouped_layout(args).is_none();
            return self.group_if(!is_loose, |e| e.plain_arguments(call));
        }
        if self.is_oxfmt && self.is_template_on_its_own_line_only_argument(call) {
            return self.arguments_on_one_line(call);
        }
        let has_empty_line =
            (args.array_windows()).any(|&[it, next]| self.is_empty_line_between(it, next));
        if has_empty_line || self.is_function_composition(call) {
            return self.all_args_broken_out(call);
        }
        if let Some(layout) = self.grouped_layout(args) {
            return self.grouped_arguments(call, layout);
        }
        if self.kind(call) == K::Call && self.is_long_curried_call(call) {
            return self.plain_arguments(call);
        }
        if self.flat.is_on {
            return self.group(|e| e.plain_arguments(call));
        }
        let start = self.f.reserve_tag();
        self.plain_arguments(call);
        let should_expand = self.f.elements_from(start + 1).will_break();
        self.group_from(start, should_expand);
    }

    #[inline]
    fn is_function_composition(&self, call: Id) -> bool {
        self.tree.is_function_composition(self.args(call))
            && self.kind(self.node(call).parent) != K::Decorators
    }

    fn arguments_with_comments(&mut self, call: Id) {
        let (list, args) = (self.node(call).c, self.args(call));
        let write = |e: &mut Self, is_expanded: bool| {
            e.token("(");
            e.soft_block_indent_with_space(is_expanded && !e.is_oxfmt, |e| {
                e.items(
                    list,
                    e.node(list).start,
                    |e, previous, next, comment| {
                        let keeps_empty_line = match e.is_oxfmt {
                            true => e.has_empty_line_before(next, comment),
                            false => e.is_next_line_empty(e.node(previous).end),
                        };
                        match keeps_empty_line {
                            true => e.line_of(LineMode::Empty),
                            false => e.line(),
                        }
                    },
                    Self::expr,
                    |e, _, is_last| match is_last {
                        true => e.trailing_comma_after_arguments(call),
                        false => e.token(","),
                    },
                );
            });
            e.token(")");
        };
        if self.is_oxfmt && self.is_template_on_its_own_line_only_argument(call) {
            return self.give_up();
        }
        let has_empty_line =
            (args.array_windows()).any(|&[it, next]| self.is_empty_line_between(it, next));
        if has_empty_line || self.is_function_composition(call) {
            return self.group_with(true, None, |e| write(e, true));
        }
        if let Some(grouped) = self.grouped_argument_among_comments(list) {
            let (node, list) = (self.node(grouped), self.node(list));
            let last_end = args.last().map_or(node.end, |&it| self.node(it).end);
            let before_last_end = [
                self.comments_between(list.start, node.start),
                self.comments_between(node.end, last_end),
            ];
            let at_end = self.comments_between(last_end, list.end);
            let is_broken = before_last_end
                .iter()
                .any(|it| self.has_line_break_after(it))
                || at_end.iter().any(|it| it.is_line);
            return match is_broken {
                true => self.group_with(true, None, |e| write(e, true)),
                false => self.give_up(),
            };
        }
        if self.kind(call) == K::Call && self.is_long_curried_call(call) {
            return write(self, false);
        }
        if self.flat.is_on {
            return self.group(|e| write(e, false));
        }
        let start = self.f.reserve_tag();
        write(self, false);
        let should_expand = self.f.elements_from(start + 1).will_break();
        self.group_from(start, should_expand);
    }

    /// The argument that's grouped. It has no comments.
    fn grouped_argument_among_comments(&mut self, list: Id) -> Option<Id> {
        let (node, args) = (self.node(list), self.list(list));
        let (&last, rest) = args.split_last()?;
        let before_last = match rest.last() {
            Some(&it) => self.comments_after_item(node, it, Some(&last)).leading_next,
            None => self.comments_between(node.start, self.node(last).start),
        };
        let has_comments = !before_last.is_empty()
            || !self
                .comments_between(self.node(last).end, node.end)
                .is_empty();
        let is_literal = matches!(self.kind(last), K::Object | K::Array);
        if has_comments
            && (self.can_group_expression_argument(last) || (is_literal && !self.is_oxfmt))
        {
            return None;
        }
        if self.grouped_layout(args)? == Grouped::Last {
            return Some(last);
        }
        let first = *args.first()?;
        let after = self.comments_after_item(node, first, Some(&last));
        let has_comments = !self
            .comments_between(node.start, self.node(first).start)
            .is_empty()
            || !(after.before_separator.is_empty() && after.at_end_of_line.is_empty())
            || (self.is_oxfmt && self.has_line_break_after(after.leading_next));
        (!has_comments).then_some(first)
    }

    fn plain_arguments(&mut self, call: Id) {
        self.token("(");
        self.soft_block_indent(|e| {
            for (i, &argument) in e.args(call).iter().enumerate() {
                if i > 0 {
                    e.token(",");
                    e.line();
                }
                e.expr(argument);
            }
            e.trailing_comma_after_arguments(call);
        });
        self.token(")");
    }

    fn is_empty_line_between(&self, argument: Id, next: Id) -> bool {
        let end = self.node(argument).end;
        match self.is_oxfmt {
            true => {
                let between = self.slice(end, self.node(next).start);
                between.len() > 2 && strings::count_char(between, b'\n') >= 2
            }
            false => self.is_next_line_empty(end),
        }
    }

    fn all_args_broken_out(&mut self, call: Id) {
        let args = self.args(call);
        self.group_with(true, None, |e| {
            e.token("(");
            e.soft_block_indent_with_space(!e.is_oxfmt, |e| {
                for (i, &argument) in args.iter().enumerate() {
                    e.expr(argument);
                    let Some(&next) = args.get(i + 1) else {
                        break;
                    };
                    e.token(",");
                    let keeps_empty_line = match e.is_oxfmt {
                        true => e.has_empty_line_before(next, None),
                        false => e.is_next_line_empty(e.node(argument).end),
                    };
                    match keeps_empty_line {
                        true => e.line_of(LineMode::Empty),
                        false => e.line(),
                    }
                }
                e.trailing_comma_after_arguments(call);
            });
            e.token(")");
        });
    }

    fn all_elements_broken_out(&mut self, call: Id, elements: &Elements) {
        self.group_with(true, None, |e| {
            e.token("(");
            e.soft_block_indent_with_space(!e.is_oxfmt, |e| {
                for (i, &element) in elements.iter().enumerate() {
                    if i > 0 {
                        e.line();
                    }
                    e.element(element);
                }
                e.trailing_comma_after_arguments(call);
            });
            e.token(")");
        });
    }

    fn grouped_layout(&mut self, args: &[Id]) -> Option<Grouped> {
        let (&last, rest) = args.split_last()?;
        let penultimate = rest.last().copied().unwrap_or(NONE);
        if self.can_group_expression_argument(last) {
            return self
                .should_group_last(args.len(), penultimate, last)
                .then_some(Grouped::Last);
        }
        (args.len() == 2 && self.should_group_first(penultimate, last)).then_some(Grouped::First)
    }

    fn should_group_first(&self, first: Id, second: Id) -> bool {
        let node = self.node(first);
        self.is_function_like(first)
            && self.kind(node.d) == K::Body
            && !matches!(self.kind(second), K::Fn | K::Arrow | K::Cond | K::Spread)
            && !(node.has(flag::PARENS) && self.is_oxfmt)
            && self.is_hopefully_short_call_argument(second)
    }

    fn should_group_last(&mut self, count: usize, penultimate: Id, last: Id) -> bool {
        let kind = self.kind(last);
        if kind == self.kind(penultimate) {
            return false;
        }
        kind != K::Array
            || count == 1
            || !((count == 2 && self.kind(penultimate) == K::Arrow)
                || self.can_concisely_print_array(last))
    }

    fn is_simple_ts_type(&self, ty: Id) -> bool {
        let mut node = self.node(ty);
        for _ in 0..2 {
            if node.kind == K::ArrayType {
                node = self.node(node.a);
            }
        }
        if let (K::TypeRef, &[only]) = (node.kind, self.list(node.b)) {
            node = self.node(only);
        }
        match node.kind {
            K::TypeRef => node.b == NONE,
            kind => matches!(kind, K::TypeKeyword | K::LiteralType | K::TemplateType),
        }
    }

    fn is_hopefully_short_call_argument(&self, id: Id) -> bool {
        let node = self.node(id);
        let is_simple = |id: Id| self.is_simple_argument(id, 1);
        match node.kind {
            K::As | K::Satisfies => self.is_simple_ts_type(node.b) && is_simple(node.a),
            K::Call if self.args(id).len() > 1 && self.is_call_expression(id) => false,
            K::New | K::ImportCall if self.args(id).len() > 1 => false,
            K::Binary | K::Logical => is_simple(node.a) && is_simple(node.b),
            K::Regex => true,
            _ => self.is_simple_argument(id, 0),
        }
    }

    fn can_group_expression_argument(&self, mut id: Id) -> bool {
        loop {
            let node = self.node(id);
            match node.kind {
                K::Object | K::Array => return node.len > 0 || node.has(flag::COMMENT),
                K::As | K::Satisfies => id = node.a,
                K::Arrow => break,
                kind => return kind == K::Fn,
            }
        }
        let mut is_recursion = false;
        loop {
            let body = self.node(id).d;
            match self.kind(body) {
                K::Body | K::Object | K::Array | K::Jsx => return true,
                K::Arrow => (id, is_recursion) = (body, true),
                K::Cond => return !is_recursion,
                _ => return !is_recursion && self.kind(self.strip_non_null(body)) == K::Call,
            }
        }
    }

    fn grouped_arguments(&mut self, call: Id, layout: Grouped) {
        let args = self.args(call);
        let last_index = args.len() - 1;
        let grouped_index = if layout == Grouped::First {
            0
        } else {
            last_index
        };
        let argument = args.get(grouped_index).copied().unwrap_or(NONE);
        let node = self.node(argument);
        let is_call = match self.kind(call) {
            K::New => self.is_oxfmt,
            kind => kind == K::Call,
        };
        let options = |grouped| match node.kind {
            K::Arrow => ExprOptions::Arrow(ArrowOptions {
                caches: true,
                grouped,
                assignment_layout: None,
            }),
            _ => ExprOptions::Function(FunctionOptions {
                caches: true,
                is_grouped: false,
            }),
        };
        let caches = match node.kind {
            K::Fn => {
                layout == Grouped::Last
                    && is_call
                    && (last_index != 0 || self.has_only_simple_parameters(argument, false))
            }
            K::Arrow => {
                self.kind(node.d) != K::Body
                    || !self.params(argument).is_empty()
                    || (node.b, node.c) != (NONE, NONE)
            }
            _ => false,
        };
        if self.flat.is_on {
            let options = match node.kind {
                _ if !caches => ExprOptions::None,
                K::Arrow => ExprOptions::Arrow(ArrowOptions {
                    grouped: Some(layout),
                    ..Default::default()
                }),
                _ => ExprOptions::Function(FunctionOptions {
                    caches: false,
                    is_grouped: true,
                }),
            };
            if caches && may_be_decorated_function(self.tree, call, argument) {
                return self.give_up();
            }
            return self.follow_grouped_arguments(call, argument, options);
        }
        let (mut elements, mut grouped_breaks) = (Elements::new(), false);
        let mut non_grouped_breaks = false;
        for (i, &it) in args.iter().enumerate() {
            let element = self.intern(|e| {
                match i == grouped_index && caches {
                    true => e.expr_with(it, options(None)),
                    false => e.expr(it),
                }
                e.token_if(i != last_index, ",");
            });
            let breaks = element.is_some_and(|it| it.will_break(self.f));
            match i == grouped_index {
                true => grouped_breaks = breaks,
                false => non_grouped_breaks |= breaks,
            }
            elements.push(element);
        }
        if non_grouped_breaks {
            return self.all_elements_broken_out(call, &elements);
        }
        let most_expanded = self.variant(|e| e.all_elements_broken_out(call, &elements));
        if caches {
            if may_be_decorated_function(self.tree, call, argument) {
                return self.give_up();
            }
            let mut function = argument;
            loop {
                let has_parameters = !self.params(function).is_empty();
                if (has_parameters || self.kind(function) == K::Arrow)
                    && (!self.remove_soft_lines_of_cached((function, Part::Parameters))
                        || (!has_parameters
                            && self.is_oxfmt
                            && !self
                                .remove_soft_lines_of_cached((function, Part::EmptyParameters))))
                {
                    return self.all_elements_broken_out(call, &elements);
                }
                function = self.node(function).d;
                if layout == Grouped::First || self.kind(function) != K::Arrow {
                    break;
                }
            }
            let element = self.intern(|e| {
                e.expr_with(argument, options(Some(layout)));
                e.token_if(grouped_index != last_index, ",");
            });
            grouped_breaks = element.is_some_and(|it| it.will_break(self.f));
            if let Some(slot) = elements.get_mut(grouped_index) {
                *slot = element;
            }
        }
        let on_one_line = |e: &mut Self, expands: bool| {
            e.token("(");
            for (i, &element) in elements.iter().enumerate() {
                if i > 0 {
                    e.line();
                }
                match expands && i == grouped_index {
                    true => e.group_with(true, None, |e| e.element(element)),
                    false => e.element(element),
                }
            }
            e.token(")");
        };
        let middle = self.variant(|e| on_one_line(e, true));
        if grouped_breaks {
            self.expand_parent();
            return self.best_fitting(&[middle, most_expanded], Fallback::MostExpanded);
        }
        let most_flat = self.variant(|e| on_one_line(e, false));
        self.best_fitting(&[most_flat, middle, most_expanded], Fallback::MostExpanded);
    }

    fn follow_grouped_arguments(&mut self, call: Id, grouped: Id, options: ExprOptions) {
        let (list, args) = (self.node(self.node(call).c), self.args(call));
        if !list.has(flag::MULTILINE) {
            return self.group(|e| {
                e.token("(");
                e.may_break();
                e.make_group_flat();
                for (i, &argument) in args.iter().enumerate() {
                    if i > 0 {
                        e.keyword(",");
                    }
                    e.expr(argument);
                }
                e.token(")");
            });
        }
        let (start, is_in_flat_variant) = (self.position(), self.follow.is_in_flat_variant());
        let before = self.follow.forced_breaks;
        let mut breaks_in_grouped = 0;
        if self.src.get(list.start as usize + 1) == Some(&b'\n') {
            let is_chain =
                self.kind(grouped) == K::Arrow && self.kind(self.node(grouped).d) == K::Arrow;
            let mut first_line = None;
            self.start_expanded_variant();
            self.token("(");
            self.soft_block_indent(|e| {
                for (i, &argument) in args.iter().enumerate() {
                    if i > 0 {
                        e.token(",");
                        e.line();
                    }
                    if argument != grouped {
                        e.expr(argument);
                        continue;
                    }
                    let before = e.follow.forced_breaks;
                    first_line = e.find_first_line(grouped, false, |e| e.expr(argument));
                    breaks_in_grouped = e.follow.forced_breaks - before;
                }
                e.trailing_comma_after_arguments(call);
            });
            self.token(")");
            self.end_group();
            if self.follow.forced_breaks - before == breaks_in_grouped {
                self.flat.matches &= !is_chain && !is_in_flat_variant;
                self.must_not_fit(start, first_line);
            }
            return;
        }
        self.token("(");
        self.may_break_in_expanded_variant();
        self.start_flat_variant();
        for (i, &argument) in args.iter().enumerate() {
            if i > 0 {
                self.keyword(",");
            }
            if argument != grouped {
                self.expr(argument);
                continue;
            }
            let before = self.follow.forced_breaks;
            self.start_expanded_variant();
            if !is_in_flat_variant {
                self.must_fit();
            }
            self.expr_with(argument, options);
            self.end_group();
            breaks_in_grouped = self.follow.forced_breaks - before;
        }
        self.token(")");
        self.end_group();
        self.flat.matches &= self.follow.forced_breaks - before == breaks_in_grouped;
        if breaks_in_grouped == 0 {
            self.flat.matches &= !is_in_flat_variant;
            self.must_not_fit(start, None);
        }
    }

    fn remove_soft_lines_of_cached(&mut self, key: (Id, Part)) -> bool {
        let Some(&cached) = self.cache.get(&key) else {
            return true;
        };
        let cached = self.capture(|e| e.element(Some(cached)));
        let Some(cleaned) = self.intern(|e| e.signature_without_lines(cached)) else {
            return true;
        };
        if cleaned.will_break(self.f) {
            return false;
        }
        self.cache.insert(key, cleaned);
        true
    }

    fn is_react_hook_with_deps_array(&self, args: &[Id]) -> bool {
        let (callback, deps) = match *args {
            [callback, deps] => (callback, deps),
            [first, callback, deps] if self.kind(first) == K::Ident => (callback, deps),
            _ => return false,
        };
        self.kind(deps) == K::Array
            && self.kind(callback) == K::Arrow
            && self.params(callback).is_empty()
            && self.kind(self.node(callback).d) == K::Body
            && !(self.node(deps).len == 0 && self.node(deps).has(flag::COMMENT))
    }

    // ───────────────────────────── members ─────────────────────────────

    pub(super) fn member_expression(&mut self, id: Id) {
        let node = self.node(id);
        let start = self.f.elements().len();
        let needs_label = node.kind == K::Dot && self.may_need_label_of_object(id);
        match needs_label {
            true if self.flat.is_on => return self.not_flat(),
            true => self.exactly(|e| e.expr(node.a)),
            false => self.expr(node.a),
        }
        self.boundary_after_object();
        if node.kind == K::Index {
            return self.computed_member(id);
        }
        if self.should_inline_member(id, start, needs_label) {
            return self.lookup(node);
        }
        self.group(|e| {
            e.indent(|e| {
                e.soft_line();
                e.lookup(node);
            });
        });
    }

    #[inline]
    pub(super) fn lookup(&mut self, member: &Node) {
        let name = self.node(member.b);
        let operator = if member.has(flag::OPTIONAL) {
            "?."
        } else {
            "."
        };
        self.token(operator);
        self.source(name.start, name.end);
    }

    fn may_need_label_of_object(&self, id: Id) -> bool {
        if self.is_flat() {
            return false;
        }
        let mut outer = self.node(self.node(id).parent);
        while outer.kind == K::NonNull {
            outer = self.node(outer.parent);
        }
        if !matches!(outer.kind, K::Assign | K::Declarator) {
            return false;
        }
        let mut object = self.node(self.node(id).a);
        loop {
            match object.kind {
                K::Dot | K::Index => object = self.node(object.a),
                K::NonNull if self.is_oxfmt => object = self.node(object.a),
                K::Call => return matches!(self.kind(object.a), K::Dot | K::Index),
                _ => return false,
            }
        }
    }

    fn should_inline_member(&self, id: Id, start: usize, needs_label: bool) -> bool {
        let node = self.node(id);
        let is_private = self.kind(node.b) == K::PrivateName;
        if is_private && self.is_oxfmt {
            return true;
        }
        let mut outer = self.node(node.parent);
        while outer.kind == K::NonNull {
            outer = self.node(outer.parent);
        }
        let is_in_member = matches!(outer.kind, K::Dot | K::Index);
        if !is_in_member && !is_private && self.kind(node.a) == K::Ident {
            return true;
        }
        let is_assignment = |node: &Node| node.kind == K::Assign && !node.has(flag::TARGET);
        if is_assignment(outer) || outer.kind == K::Declarator {
            let object = self.strip_non_null(node.a);
            if (self.kind(object) == K::Call && !self.args(object).is_empty())
                || (needs_label
                    && (self.f.elements_from(start)).has_label(LabelId::of(JsLabels::MemberChain)))
            {
                return true;
            }
        }
        let looks_through_chains = self.is_javascript || self.is_oxfmt;
        let (mut child, mut is_on_left_edge) = (id, true);
        loop {
            if !looks_through_chains && self.is_chain_root(child) {
                return false;
            }
            let parent = self.node(child).parent;
            let above = self.node(parent);
            match above.kind {
                K::Dot | K::Index | K::NonNull => {
                    is_on_left_edge &= above.a == child;
                    child = parent;
                }
                K::New => return is_on_left_edge,
                _ => return is_assignment(above) && self.kind(above.a) != K::Ident,
            }
        }
    }

    pub(super) fn may_have_embedded_language(&self, template: Id) -> bool {
        let parent = self.node(self.node(template).parent);
        match parent.kind {
            K::Tagged if parent.c == template => {
                let tag = self.text_of(parent.a);
                let root = tag.iter().take_while(|it| it.is_ascii_alphabetic()).count();
                matches!(
                    tag.get(..root),
                    Some(
                        b"" | b"css"
                            | b"styled"
                            | b"gql"
                            | b"graphql"
                            | b"html"
                            | b"md"
                            | b"markdown"
                    )
                ) && tag != b"$"
                    || strings::contains(tag, b"extend")
                    || tag.ends_with(b"each")
            }
            K::JsxContainer => match self.node(parent.parent) {
                above if above.kind == K::JsxAttr => self.text_of(above.a) == b"css",
                above => self.text_of(self.node(above.a).a) == b"style",
            },
            K::Args => self.is_name(self.node(parent.parent).a, b"graphql"),
            _ => false,
        }
    }
}

fn may_be_decorated_function(tree: &Tree, call: Id, argument: Id) -> bool {
    let node = tree.node(call);
    node.kind == K::Call
        && tree.kind(node.a) == K::Call
        && tree.kind(argument) == K::Arrow
        && tree.kind(tree.node(argument).d) == K::Body
        && tree.list(node.c).len() == 1
        && matches!(
            tree.kind(node.parent),
            K::Declarator | K::ExportDefault | K::Assign
        )
}
