use super::*;

/// The head of the chain, then the node of each link.
type Members = SmallVec<[Id; 12]>;
type GroupEnds = SmallVec<[usize; 8]>;

fn is_factory(name: &[u8]) -> bool {
    match name.split_first() {
        Some((b'_' | b'$', rest)) => rest.iter().all(|b| matches!(b, b'_' | b'$')),
        Some((first, _)) => first.is_ascii_uppercase(),
        None => false,
    }
}

impl Emitter<'_, '_> {
    fn starts_chain(&self, member: &Node) -> bool {
        self.is_oxfmt && member.kind == K::Dot && self.kind(member.b) == K::PrivateName
    }

    /// Also returns true if there's another call among the links.
    fn chain_members(&self, root: Id) -> (Members, bool) {
        let mut members = Members::new();
        members.push(root);
        let (mut current, mut has_inner_call) = (self.node(root).a, false);
        loop {
            members.push(current);
            let node = self.node(current);
            let continues = match node.kind {
                K::Call => {
                    (self.is_member_expression(node.a) && !self.starts_chain(self.node(node.a)))
                        || self.is_call_expression(node.a)
                }
                K::Dot => !self.starts_chain(node),
                kind => matches!(kind, K::Index | K::NonNull),
            };
            if !continues || (self.is_chain_root(current) && self.needs_parentheses(current)) {
                break;
            }
            has_inner_call |= node.kind == K::Call;
            current = node.a;
        }
        members.reverse();
        (members, has_inner_call)
    }

    fn is_computed_array_member_access(&self, id: Id) -> bool {
        let node = self.node(id);
        node.kind == K::Index && self.kind(node.b) == K::Num
    }

    fn chain_groups(&self, root: Id, members: &[Id]) -> GroupEnds {
        let is_member = |id: Id| matches!(self.kind(id), K::Dot | K::Index);
        let mut head_end = 1
            + (members.iter().skip(1))
                .take_while(|&&it| {
                    matches!(self.kind(it), K::Call | K::NonNull)
                        || self.is_computed_array_member_access(it)
                })
                .count();
        if !members
            .first()
            .is_some_and(|&it| self.is_call_expression(it))
        {
            let rest = members.get(head_end..).unwrap_or_default();
            head_end += (rest.iter().position(|&it| !is_member(it)))
                .map_or(rest.len(), |index| index.saturating_sub(1));
        }
        let mut ends = GroupEnds::new();
        ends.push(head_end);
        let mut has_seen_call = false;
        for (index, &member) in members.iter().enumerate().skip(head_end) {
            if self.kind(member) == K::Call {
                has_seen_call = true;
            } else if has_seen_call
                && is_member(member)
                && !self.is_computed_array_member_access(member)
            {
                ends.push(index);
                has_seen_call = false;
            }
        }
        if head_end < members.len() {
            ends.push(members.len());
            if self.should_merge_tail_with_head(root, members, head_end) {
                ends.remove(0);
            }
        }
        ends
    }

    fn should_merge_tail_with_head(&self, root: Id, members: &[Id], head_end: usize) -> bool {
        let at = |index: usize| members.get(index).copied().unwrap_or(NONE);
        let has_computed_property = self.kind(at(head_end)) == K::Index;
        let last = self.node(at(head_end - 1));
        if head_end == 1 {
            let name = self.text_of(at(0));
            return match last.kind {
                K::Ident => {
                    has_computed_property
                        || is_factory(name)
                        || (name.len() <= self.f.options().indent_width.value() as usize
                            && self.kind(self.node(root).parent) == K::ExprStmt)
                }
                kind => kind == K::This,
            };
        }
        let has_name = self.kind(last.b) == K::Ident
            && (last.kind == K::Dot || (last.kind == K::Index && !self.is_oxfmt));
        has_name && (has_computed_property || is_factory(self.text_of(last.b)))
    }

    pub(super) fn is_member_call_chain(&self, call: Id) -> bool {
        let (members, has_inner_call) = self.chain_members(call);
        has_inner_call && self.chain_groups(call, &members).len() > 2
    }

    pub(super) fn computed_member(&mut self, id: Id) {
        let node = self.node(id);
        let is_number = self.kind(node.b) == K::Num;
        self.group_if(!is_number, |e| {
            e.token_if(node.has(flag::OPTIONAL), "?.");
            e.token("[");
            match is_number {
                true => e.expr(node.b),
                false => e.soft_block_indent(|e| e.expr(node.b)),
            }
            e.token("]");
        });
    }

    fn chain_links(&mut self, members: &[Id], from: usize, to: usize) {
        for (index, &member) in members.iter().enumerate().take(to).skip(from) {
            let node = self.node(member);
            match node.kind {
                _ if index == 0 => self.expr(member),
                K::Dot => self.lookup(node),
                K::NonNull => self.token("!"),
                K::Index => {
                    if self.is_oxfmt {
                        self.boundary();
                    }
                    self.computed_member(member);
                }
                _ => {
                    self.token_if(node.has(flag::OPTIONAL), "?.");
                    self.type_arguments(node.b);
                    self.arguments(member);
                }
            }
        }
    }

    fn has_empty_line_between_links(&self, members: &[Id]) -> bool {
        members.array_windows().any(|&[object, link]| {
            let end = self.node(object).end;
            let next = self.node(link);
            let after = match next.kind {
                K::Dot | K::Index => self.node(next.b).start,
                K::Call if next.b != NONE => self.node(next.b).start,
                K::Call => self.node(next.c).start,
                _ => next.end,
            };
            after > end + 2 && strings::count_char(self.slice(end, after), b'\n') > 1
        })
    }

    fn has_many_calls_with_complex_arguments(&self, members: &[Id]) -> bool {
        let is_call = |(index, &it): (usize, &Id)| match index {
            0 => self.is_call_expression(it).then_some(it),
            _ => (self.kind(it) == K::Call).then_some(it),
        };
        let calls = || members.iter().enumerate().filter_map(is_call);
        calls().count() > 2
            && calls().any(|it| {
                !self
                    .args(it)
                    .iter()
                    .all(|&it| self.is_simple_argument(it, 0))
            })
    }

    pub(super) fn member_chain(&mut self, root: Id) {
        let (members, has_inner_call) = self.chain_members(root);
        if !self.is_flat() && self.has_empty_line_between_links(&members) {
            return self.give_up();
        }
        let ends = match has_inner_call {
            true => self.chain_groups(root, &members),
            false => GroupEnds::new(),
        };
        if ends.len() <= 2 {
            return self.group_if(!self.is_long_curried_call(root), |e| {
                e.chain_links(&members, 0, members.len());
            });
        }
        let must_break = self.has_many_calls_with_complex_arguments(&members);
        let head_end = ends.first().copied().unwrap_or(0);
        if self.is_flat() {
            return self.group_with(must_break, None, |e| {
                e.chain_links(&members, 0, head_end);
                e.may_break();
                e.chain_links(&members, head_end, members.len());
            });
        }
        let has_function_argument = |&it: &Id| {
            it != root
                && self.kind(it) == K::Call
                && (members.first() != Some(&it) || self.is_call_expression(it))
                && self
                    .args(it)
                    .iter()
                    .any(|&it| matches!(self.kind(it), K::Fn | K::Arrow))
        };
        let has_function_argument = members.iter().any(has_function_argument);
        if self.flat.is_on {
            return self.follow_member_chain(&members, &ends, must_break, has_function_argument);
        }
        let mut formatted = SmallVec::<[Option<FormatElement>; 8]>::new();
        let mut start = 0;
        for &end in &ends {
            formatted.push(self.intern(|e| e.chain_links(&members, start, end)));
            start = end;
        }
        let will_break =
            |group: &Option<FormatElement>| group.is_some_and(|it| it.will_break(self.f));
        let Some((last, others)) = formatted.split_last() else {
            return;
        };
        let last_group_breaks = will_break(last);
        let must_break = must_break
            || others.iter().any(will_break)
            || (last_group_breaks && has_function_argument);
        let expanded = |e: &mut Self| {
            e.element(formatted.first().copied().flatten());
            e.indent(|e| {
                for &group in formatted.iter().skip(1) {
                    e.hard_line();
                    e.element(group);
                }
            });
        };
        self.member_chain_label(|e| {
            if must_break {
                return e.group(expanded);
            }
            if last_group_breaks {
                e.expand_parent();
            }
            let one_line = e.variant(|e| formatted.iter().for_each(|&it| e.element(it)));
            let expanded = e.variant(expanded);
            e.best_fitting(&[one_line, expanded], Fallback::MostExpanded);
        });
    }

    fn follow_member_chain(
        &mut self,
        members: &[Id],
        ends: &[usize],
        must_break: bool,
        has_function_argument: bool,
    ) {
        let (&[head_end, ..], &[.., last_start, _]) = (ends, ends) else {
            return self.not_flat();
        };
        let at = |index: usize| self.node(members.get(index).copied().unwrap_or(NONE));
        let (head, root) = (at(head_end - 1), at(members.len() - 1));
        let after_head = head.end + u32::from(head_end == 1 && head.has(flag::PARENS));
        let (start, is_in_flat_variant) = (self.position(), self.follow.is_in_flat_variant());
        let before = self.follow.forced_breaks;
        if self.src.get(after_head as usize) == Some(&b'\n') {
            let (mut first_line, mut before_last) = (None, before);
            self.start_expanded_variant();
            self.chain_links(members, 0, head_end);
            self.indent(|e| {
                for &[from, to] in ends.array_windows() {
                    e.soft_line();
                    before_last = e.follow.forced_breaks;
                    first_line =
                        e.find_first_line(NONE, true, |e| e.chain_links(members, from, to));
                }
            });
            self.end_group();
            let last_group_breaks = self.follow.forced_breaks != before_last;
            if must_break || before_last != before || (last_group_breaks && has_function_argument) {
                return self.force_break();
            }
            self.flat.matches &= !is_in_flat_variant;
            return self.must_not_fit(start, first_line.filter(|_| last_group_breaks));
        }
        self.flat.matches &= !must_break;
        if !root.has(flag::MULTILINE) {
            return self.group(|e| {
                e.make_group_flat();
                e.chain_links(members, 0, head_end);
                e.may_break();
                e.chain_links(members, head_end, members.len());
            });
        }
        self.start_flat_variant();
        if !is_in_flat_variant {
            self.must_fit();
        }
        self.chain_links(members, 0, head_end);
        self.may_break();
        self.chain_links(members, head_end, last_start);
        self.flat.matches &= self.follow.forced_breaks == before && !has_function_argument;
        self.chain_links(members, last_start, members.len());
        self.end_group();
    }

    pub(super) fn is_simple_argument(&self, mut id: Id, depth: usize) -> bool {
        if depth >= 2 {
            return false;
        }
        let are_simple = |call: Id| {
            let args = self.args(call);
            args.len() + depth <= 2
                && args
                    .iter()
                    .all(|&it| self.is_simple_argument(it, depth + 1))
        };
        loop {
            let node = self.node(id);
            let items = self.tree.list_of(node);
            match node.kind {
                K::Null
                | K::Bool
                | K::Str
                | K::Num
                | K::BigInt
                | K::This
                | K::Ident
                | K::PrivateName
                | K::Super => return true,
                K::Regex => {
                    let text = self.text_of(id);
                    let end = strings::last_index_of_char(text, b'/').unwrap_or(0);
                    let pattern = text.get(1..end).unwrap_or_default();
                    return match self.is_oxfmt {
                        true => pattern.len() <= 5,
                        false => crate::ir::width::string_width(pattern) <= 5,
                    };
                }
                K::Template => {
                    return items.iter().all(|&it| match self.kind(it) {
                        K::Quasi => !strings::contains_char(self.text_of(it), b'\n'),
                        _ => self.is_simple_argument(it, depth + 1),
                    });
                }
                K::Object => {
                    return items.iter().all(|&it| {
                        let property = self.node(it);
                        property.op == T::Ident
                            || (property.op == T::Colon
                                && !property.has(flag::COMPUTED)
                                && self.is_simple_argument(property.b, depth + 1))
                    });
                }
                K::Array => {
                    return items.iter().all(|&it| {
                        self.kind(it) == K::Hole || self.is_simple_argument(it, depth + 1)
                    });
                }
                K::Unary if matches!(node.op, T::Bang | T::Minus | T::Plus | T::Tilde) => {}
                K::Update if !self.is_oxfmt || self.kind(node.a) == K::Ident => {}
                K::NonNull | K::Dot => {}
                K::Index if self.is_simple_argument(node.b, depth) => {}
                K::New | K::Call if are_simple(id) => {}
                K::ImportCall => return are_simple(id),
                _ => return false,
            }
            id = node.a;
        }
    }
}
