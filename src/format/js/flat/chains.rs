//! Chains of calls and member accesses that aren't on one line.

use super::*;
use crate::js::print::call_like_expression::arguments::hugged_function_keeps_parameters_on_one_line;
use crate::js::utils::member_chain::chain_member::ChainMember;
use crate::js::utils::member_chain::{MemberChain, Members, push_chain_members};

/// The call that `member` is, or ends with.
fn call_of<'a>(member: &ChainMember<'a>) -> Option<Call<'a>> {
    match *member {
        ChainMember::CallExpression { expression, .. } => expression.as_call(),
        ChainMember::Node(e) => e.as_call(),
        _ => None,
    }
}

impl<'a> Line<'_, 'a> {
    /// The call `e`, whose callee is a member access, with nothing but closing brackets after it.
    pub(super) fn member_chain(&mut self, e: Expr<'a>) -> Written {
        if self.width != Width::Known {
            return Err(Refused);
        }
        let mut members = Members::new();
        let has_inner_call = push_chain_members(e, &mut members, self.f);
        members.reverse();
        let tail = self.tail;
        if !has_inner_call {
            return self.links(&members, tail);
        }
        let chain = MemberChain::new(e, &members, self.f);
        let count = chain.tail_len();
        if count <= 1 {
            return self.links(&members, tail);
        }
        let call = e.as_call().ok_or(Refused)?;
        let args = call.args();
        if !self.breaks_whether_it_fits_or_not(&members, &chain)? {
            if !self.breaks {
                self.expr(call.callee(), Place::Object)?;
                if call.is_optional() {
                    self.token("?.")?;
                }
                self.type_arguments(call.type_args())?;
                return self.arguments(e, args, true, false);
            }
            // It's on one line if it fits up to the first line break in its last call. That's the one after the `{` of
            // a function, unless its head can break.
            let parent = AstNodes::CallExpression(e);
            if let Some(function) = args.last().and_then(Expr::as_fn) {
                self.check_parameters_of_hugged(function)?;
            }
            if (args.last().and_then(Expr::as_fn)).is_some_and(|function| {
                !function.is_arrow()
                    && (self.hugged_head_can_break(function)
                        || !hugged_function_keeps_parameters_on_one_line(
                            function,
                            args.len(),
                            parent,
                            self.f,
                        ))
            }) {
                return Err(Refused);
            }
        }
        self.links(chain.group(0), 0)?;
        self.break_line(1)?;
        for index in 1..=count {
            if index > 1 {
                self.break_line(0)?;
            }
            self.links(chain.group(index), if index == count { tail } else { 0 })?;
        }
        self.outdent()
    }

    /// Prettier's `shouldNotWrap` and the checks after it, for a chain of more than two groups. Refuses a chain if it
    /// isn't known where line breaks are forced in it.
    fn breaks_whether_it_fits_or_not(
        &mut self,
        members: &[ChainMember<'a>],
        chain: &MemberChain<'a, '_>,
    ) -> Result<bool, Refused> {
        let (mut calls, mut has_complex_arguments, mut has_function) = (0, false, false);
        let mut last_has_function = false;
        for call in members.iter().filter_map(call_of) {
            calls += 1;
            has_function |= last_has_function;
            last_has_function = call.args().iter().any(|it| it.tag() == ExprTag::Fn);
            let f = &*self.f;
            has_complex_arguments = has_complex_arguments
                || !(call.args().iter()).all(|it| SimpleArgument::new(it, f).is_simple());
        }
        let count = chain.tail_len();
        let mut breaks = calls > 2 && has_complex_arguments;
        for index in 0..=count {
            let ends_with_call = matches!(
                chain.group(index).last(),
                Some(ChainMember::CallExpression { .. })
            );
            breaks |= self.has_forced_line_break(chain.group(index))?
                && (index < count || (has_function && ends_with_call));
        }
        Ok(breaks)
    }

    /// True if a line break is forced in the arguments of a call among `members`. It's known to be if the last argument
    /// is hugged and certain to break, and known not to be if all of them can be written on one line.
    fn has_forced_line_break(&mut self, members: &[ChainMember<'a>]) -> Result<bool, Refused> {
        let mut has_line_break = false;
        for call in members.iter().filter_map(call_of) {
            let args = call.args();
            let is_hugged = args.last().is_some_and(|last| self.ends_line(last));
            has_line_break |= is_hugged;
            let others = args.len().saturating_sub(usize::from(is_hugged));
            if !self.can_be_on_one_line(|line| {
                line.list(args.iter().take(others), |line, argument| {
                    // An empty line between two properties stays.
                    match has_empty_line(line.text_of(argument.span())) {
                        true => Err(Refused),
                        false => line.expr(argument, Place::Free),
                    }
                })
            }) {
                return Err(Refused);
            }
        }
        Ok(has_line_break)
    }

    /// The links `members`, one after the other. The arguments of each call are on the line if they fit together with
    /// what follows them up to the next place where the line can break. `tail` columns follow the last link.
    fn links(&mut self, members: &[ChainMember<'a>], tail: usize) -> Written {
        for (index, member) in members.iter().enumerate() {
            let call = match *member {
                ChainMember::StaticMember(e) => {
                    let (_, name, chain) = e.as_dot().ok_or(Refused)?;
                    self.token(match chain {
                        Chain::Start => "?.",
                        _ => ".",
                    })?;
                    self.source(name.span())?;
                    continue;
                }
                ChainMember::TSNonNullExpression(e) => {
                    if e.non_null_count() != 1 {
                        return Err(Refused);
                    }
                    self.byte(b'!')?;
                    continue;
                }
                // The line can break after the `[`, unless there's a number in it.
                ChainMember::ComputedMember(_) => return Err(Refused),
                ChainMember::Node(e) => match e.tag() {
                    ExprTag::Ident | ExprTag::This | ExprTag::Super => {
                        self.expr(e, Place::Object)?;
                        continue;
                    }
                    ExprTag::Call => {
                        let call = e.as_call().ok_or(Refused)?;
                        if call.callee().tag() != ExprTag::Ident
                            || e.is_chain_root()
                            || keeps_arguments_on_one_line(e, call, self.f)
                        {
                            return Err(Refused);
                        }
                        self.expr(call.callee(), Place::Object)?;
                        e
                    }
                    _ => return Err(Refused),
                },
                ChainMember::CallExpression { expression, .. } => expression,
            };
            let (e, call) = (call, call.as_call().ok_or(Refused)?);
            // The type arguments can break, and the arguments of a call of a call have a layout of their own.
            if !call.type_args().is_empty() || call.callee().tag() == ExprTag::Call {
                return Err(Refused);
            }
            if call.is_optional() {
                self.token("?.")?;
            }
            if call.args().is_empty() {
                self.token("()")?;
                continue;
            }
            let after = width_up_to_next_break(members.get(index + 1..).unwrap_or_default(), tail)?;
            self.fits_or_breaks(after, &|line| line.arguments(e, call.args(), true, true))?;
        }
        Ok(())
    }
}

/// How wide `members` are up to the first place where the line can break: after the `(` of a call with arguments. `tail`
/// columns follow the last of them.
fn width_up_to_next_break(members: &[ChainMember<'_>], tail: usize) -> Result<usize, Refused> {
    let mut width = 0;
    for member in members {
        match *member {
            ChainMember::StaticMember(e) => {
                let (_, name, chain) = e.as_dot().ok_or(Refused)?;
                width += name.span().len() as usize + if chain == Chain::Start { 2 } else { 1 };
            }
            ChainMember::TSNonNullExpression(e) => width += e.non_null_count(),
            ChainMember::CallExpression { expression, .. } => {
                let call = expression.as_call().ok_or(Refused)?;
                if !call.type_args().is_empty() {
                    return Err(Refused);
                }
                width += if call.is_optional() { 2 } else { 0 };
                if !call.args().is_empty() {
                    return Ok(width + 1);
                }
                width += 2;
            }
            ChainMember::ComputedMember(_) | ChainMember::Node(_) => return Err(Refused),
        }
    }
    Ok(width + tail)
}
