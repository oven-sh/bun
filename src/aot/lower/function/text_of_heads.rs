use std::cell::Cell;

use bun_sema::erasure::ReplacedText;
use bun_sema::hir::{
    Chain, ExprId, ExprKind, File, Flags, FnBody, FnKind, Func, PatId, PatKind, PropKey,
    end_of_expr, is_parenthesized, parentheses_around, start_of,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Kind {
    Word,
    Expression,
    Open,
    Close,
    OpenBrace,
    CloseBrace,
    Comma,
    Colon,
    Equals,
    Arrow,
    Dots,
    Star,
}

#[derive(Copy, Clone)]
struct Token {
    start: u32,
    end: u32,
    kind: Kind,
}

fn merge_ranges_of(replaced: &[ReplacedText]) -> Vec<(u32, u32)> {
    let mut others: Vec<(u32, u32)> = replaced.iter().map(|it| (it.start, it.end)).collect();
    others.sort_unstable();
    let mut merged: Vec<(u32, u32)> = Vec::with_capacity(others.len());
    for (start, end) in others {
        match merged.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => merged.push((start, end)),
        }
    }
    merged
}

pub(super) fn find_text_of_heads(
    hir: &File<'_>,
    types: &[(u32, u32)],
    replaced: &[ReplacedText],
) -> Vec<ReplacedText> {
    let mut removed: Vec<(u32, u32)> = Vec::with_capacity(types.len());
    for &(start, end) in types {
        match removed.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => removed.push((start, end)),
        }
    }
    let taken = merge_ranges_of(replaced);
    let written_by_loader = |index: usize| {
        let mut written = hir.functions_written_by_loader.iter();
        written.any(|it| it.function.idx() == index)
    };
    let mut found = Vec::new();
    let mut head = Head {
        hir,
        text: &hir.text,
        types: &removed,
        first_type: 0,
        types_that_end_by: Cell::new((0, 0)),
        expressions: Vec::new(),
        tokens: Vec::new(),
        parts: Vec::new(),
    };
    for (index, function) in hir.fns.iter().enumerate() {
        if matches!(function.body, FnBody::None)
            || function.kind == FnKind::StaticBlock
            || function.flags.contains(Flags::REPARSED)
            || written_by_loader(index)
        {
            continue;
        }
        head.parts.clear();
        if head.lay(function).is_none() {
            continue;
        }
        let meets_other_text = head.parts.iter().any(|part| {
            let next = taken.partition_point(|other| other.1 <= part.start);
            let first_behind = part.end.max(part.start);
            (taken.get(next)).is_some_and(|other| match part.start == part.end {
                true => other.0 < part.start,
                false => other.0 < first_behind,
            })
        });
        if !meets_other_text {
            found.append(&mut head.parts);
        }
    }
    found
}

fn is_name_or_member_of_name(hir: &File<'_>, mut expression: ExprId) -> bool {
    loop {
        expression = match hir[expression].kind {
            ExprKind::Ident(_) | ExprKind::This => return true,
            ExprKind::Dot {
                obj,
                chain: Chain::No,
                ..
            }
            | ExprKind::Index {
                obj,
                chain: Chain::No,
                ..
            } if !is_parenthesized(hir, obj) => obj,
            _ => return false,
        };
    }
}

pub(super) fn find_parentheses_left_by_types(
    hir: &File<'_>,
    replaced: &[ReplacedText],
) -> Vec<ReplacedText> {
    let taken = merge_ranges_of(replaced);
    let mut found = Vec::new();
    for (index, expression) in hir.exprs.iter().enumerate() {
        let mut operand = match expression.kind {
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) => expr,
            _ => continue,
        };
        let around = parentheses_around(hir, ExprId(index as u32));
        let Some(&outermost) = around.last() else {
            continue;
        };
        let mut pairs = around.to_vec();
        pairs.extend_from_slice(parentheses_around(hir, operand));
        while let ExprKind::As { expr, .. }
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::AsConst(expr)
        | ExprKind::NonNull(expr) = hir[operand].kind
        {
            operand = expr;
            pairs.extend_from_slice(parentheses_around(hir, operand));
        }
        if !is_name_or_member_of_name(hir, operand) {
            continue;
        }
        let next = taken.partition_point(|other| other.1 < outermost.1);
        if taken.get(next).is_some_and(|other| other.0 <= outermost.2) {
            continue;
        }
        let inside = &hir.text[outermost.1 as usize..outermost.2 as usize];
        let holds = |end_of_line: &[u8]| bun_core::strings::index_of(inside, end_of_line).is_some();
        if holds(b"\n") || holds(b"\r") || holds(b"\xe2\x80\xa8") || holds(b"\xe2\x80\xa9") {
            continue;
        }
        let behind = &hir.text[outermost.2 as usize..];
        let spaces = behind.iter().take_while(|&&byte| is_space(byte)).count();
        let (b'.' | b'?') = behind.get(spaces).copied().unwrap_or_default() else {
            continue;
        };
        let name = match behind[spaces] {
            b'?' if behind.get(spaces + 1) != Some(&b'.') => continue,
            b'?' => spaces + 2,
            _ => spaces + 1,
        };
        if !behind.get(name).is_some_and(|&byte| is_part_of_word(byte)) {
            continue;
        }
        let joins_words = |at: Option<usize>| {
            let byte = at.and_then(|at| hir.text.get(at));
            byte.is_some_and(|&byte| is_part_of_word(byte) || byte == b'>')
        };
        for (_, start, end) in pairs {
            let before = joins_words((start as usize).checked_sub(1));
            let behind = joins_words(Some(end as usize));
            for (at, is_kept_apart) in [(start, before), (end - 1, behind)] {
                found.push(ReplacedText {
                    start: at,
                    end: at + 1,
                    text: match is_kept_apart {
                        true => Box::new(*b" "),
                        false => Box::default(),
                    },
                });
            }
        }
    }
    found
}

struct Head<'a, 's> {
    hir: &'a File<'s>,
    text: &'a [u8],
    types: &'a [(u32, u32)],
    first_type: usize,
    types_that_end_by: Cell<(usize, usize)>,
    expressions: Vec<(u32, u32)>,
    tokens: Vec<Token>,
    parts: Vec<ReplacedText>,
}

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\r' | b'\n' | 0x0b | 0x0c)
}

fn is_part_of_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | b'#' | b'\\') || byte >= 0x80
}

impl Head<'_, '_> {
    fn removes(&self, at: usize) -> bool {
        let (asked, passed) = self.types_that_end_by.get();
        let from = if asked <= at { passed } else { self.first_type };
        let ended = self.types[from..]
            .iter()
            .take_while(|range| range.1 as usize <= at);
        let next = from + ended.count();
        self.types_that_end_by.set((at, next));
        let next = self.types.get(next);
        next.is_some_and(|range| range.0 as usize <= at)
    }

    fn add_expression(&mut self, expression: ExprId) {
        if expression.is_some() {
            let (start, end) = (
                start_of(self.hir, expression),
                end_of_expr(self.hir, expression),
            );
            self.expressions.push((start, end));
        }
    }

    fn add_pattern(&mut self, pattern: PatId) {
        let hir = self.hir;
        let Some(pattern) = pattern.some() else {
            return;
        };
        match hir[pattern].kind {
            PatKind::Object(properties) => {
                for property in &hir.pat_props[properties.range()] {
                    if let PropKey::Computed(key) = property.key {
                        self.add_expression(key);
                    }
                    self.add_pattern(property.value);
                    self.add_expression(property.default);
                }
            }
            PatKind::Array(elements) => {
                for element in &hir.pat_elems[elements.range()] {
                    self.add_pattern(element.pat);
                    self.add_expression(element.default);
                }
            }
            PatKind::Ident(_) | PatKind::Missing => {}
        }
    }

    fn skip_comment(&self, at: usize) -> Option<usize> {
        match self.text.get(at + 1)? {
            b'/' => {
                let rest = &self.text[at..];
                let length = bun_core::strings::index_of_any(rest, b"\n\r");
                Some(at + length.unwrap_or(rest.len()))
            }
            b'*' => {
                let rest = &self.text[at + 2..];
                let length = bun_core::strings::index_of(rest, b"*/")?;
                Some(at + 2 + length + 2)
            }
            _ => None,
        }
    }

    fn skip_trivia(&self, mut at: usize) -> Option<usize> {
        loop {
            let byte = *self.text.get(at)?;
            if self.removes(at) || is_space(byte) {
                at += 1;
            } else if byte == b'/'
                && let Some(end) = self.skip_comment(at)
            {
                at = end;
            } else {
                return Some(at);
            }
        }
    }

    fn take_token(&self, at: usize, next_expression: &mut usize) -> Option<Token> {
        while (self.expressions.get(*next_expression)).is_some_and(|it| (it.0 as usize) < at) {
            *next_expression += 1;
        }
        if let Some(&(start, end)) = self.expressions.get(*next_expression)
            && start as usize == at
        {
            return (start < end).then_some(Token {
                start,
                end,
                kind: Kind::Expression,
            });
        }
        let text = self.text;
        let (kind, length) = match text[at] {
            b'(' | b'[' => (Kind::Open, 1),
            b')' | b']' => (Kind::Close, 1),
            b'{' => (Kind::OpenBrace, 1),
            b'}' => (Kind::CloseBrace, 1),
            b',' => (Kind::Comma, 1),
            b':' => (Kind::Colon, 1),
            b'*' => (Kind::Star, 1),
            b'=' if text.get(at + 1) == Some(&b'>') => (Kind::Arrow, 2),
            b'=' => (Kind::Equals, 1),
            b'.' if text.get(at..at + 3) == Some(b"...") => (Kind::Dots, 3),
            quote @ (b'"' | b'\'') => {
                let mut end = at + 1;
                while *text.get(end)? != quote {
                    end += 1 + usize::from(text[end] == b'\\');
                }
                (Kind::Word, end + 1 - at)
            }
            byte if is_part_of_word(byte) => {
                let rest = &text[at..];
                let length = rest.iter().position(|&byte| !is_part_of_word(byte));
                let length = length.unwrap_or(rest.len());
                if bun_core::strings::contains_char(&rest[..length], b'\\') {
                    return None;
                }
                (Kind::Word, length)
            }
            _ => return None,
        };
        let removes_part = (at..at + length).any(|inside| self.removes(inside));
        (!removes_part).then_some(Token {
            start: at as u32,
            end: (at + length) as u32,
            kind,
        })
    }

    fn leave_out(&mut self, start: usize, end: usize) {
        self.parts.push(ReplacedText {
            start: start as u32,
            end: end as u32,
            text: Box::default(),
        });
    }

    fn lay_gap(&mut self, from: usize, to: usize, has_space: bool) {
        let text = self.text;
        let mut is_written = !has_space;
        let mut removes_some = false;
        let mut at = from;
        while at < to {
            if self.removes(at) {
                removes_some = true;
                at += 1;
                continue;
            }
            let mut end = at;
            while end < to && !self.removes(end) {
                end += 1;
            }
            if is_written {
                self.leave_out(at, end);
            } else if text[at] == b' ' {
                if at + 1 < end {
                    self.leave_out(at + 1, end);
                }
            } else {
                self.parts.push(ReplacedText {
                    start: at as u32,
                    end: end as u32,
                    text: Box::new(*b" "),
                });
            }
            is_written = true;
            at = end;
        }
        if is_written {
            return;
        }
        let part = match removes_some {
            false => ReplacedText {
                start: to as u32,
                end: to as u32,
                text: Box::new(*b" "),
            },
            true => ReplacedText {
                start: from as u32 - 1,
                end: from as u32,
                text: Box::new([text[from - 1], b' ']),
            },
        };
        self.parts.push(part);
    }

    fn lay(&mut self, function: &Func) -> Option<()> {
        let hir = self.hir;
        let is_arrow = function.kind == FnKind::Arrow;
        let is_async = function.flags.contains(Flags::ASYNC);
        let (start, anchor) = (function.text_start as usize, function.anchor as usize);
        if start > anchor || anchor >= self.text.len() {
            return None;
        }
        self.first_type = self
            .types
            .partition_point(|range| range.1 as usize <= start);
        self.types_that_end_by.set((0, self.first_type));
        self.expressions.clear();
        for parameter in &hir.params[function.params.range()] {
            self.add_pattern(parameter.pat);
            self.add_expression(parameter.default);
        }
        self.expressions.sort_unstable();

        self.tokens.clear();
        let mut next_expression = 0;
        let mut depth = 0u32;
        let mut at = self.skip_trivia(start)?;
        if at != start {
            return None;
        }
        if !is_arrow && bun_core::strings::contains_char(&self.text[start..anchor], b'[') {
            at = anchor;
        }
        let body = loop {
            let token = self.take_token(at, &mut next_expression)?;
            let in_front_of_parameters = !is_arrow && (token.start as usize) < anchor;
            match token.kind {
                Kind::Open | Kind::OpenBrace if !in_front_of_parameters => depth += 1,
                Kind::Close | Kind::CloseBrace if !in_front_of_parameters => {
                    depth = depth.checked_sub(1)?;
                }
                Kind::Word | Kind::Star if in_front_of_parameters => {}
                _ if in_front_of_parameters => return None,
                _ => {}
            }
            self.tokens.push(token);
            at = self.skip_trivia(token.end as usize)?;
            let ends_head = match is_arrow {
                true => token.kind == Kind::Arrow && token.start as usize == anchor,
                false => token.kind == Kind::Close && depth == 0,
            };
            if ends_head {
                break at;
            }
            if is_arrow && token.start as usize > anchor {
                return None;
            }
        };
        if depth != 0 || (!is_arrow && self.text[body] != b'{') {
            return None;
        }

        let tokens = std::mem::take(&mut self.tokens);
        let kept = |index: usize| {
            let next = tokens
                .get(index + 1)
                .map(|next| (next.kind, self.text[next.start as usize]));
            let before = index.checked_sub(1).map(|before| tokens[before].kind);
            tokens[index].kind != Kind::Comma
                || match next {
                    Some((Kind::Close, b')')) | Some((Kind::CloseBrace, _)) => false,
                    Some((Kind::Close, _)) => matches!(before, Some(Kind::Comma | Kind::Open)),
                    _ => true,
                }
        };
        let kept: Vec<bool> = (0..tokens.len()).map(kept).collect();
        let name = usize::from(is_async);
        let has_bare_parameter = is_arrow
            && tokens.get(name).is_some_and(|it| it.kind == Kind::Word)
            && tokens
                .get(name + 1)
                .is_some_and(|it| it.kind == Kind::Arrow);
        if is_arrow && !has_bare_parameter && tokens.get(name)?.kind != Kind::Open {
            self.tokens = tokens;
            return None;
        }
        if has_bare_parameter {
            let (start, end) = (tokens[name].start, tokens[name].end);
            let written = &self.text[start as usize..end as usize];
            self.parts.push(ReplacedText {
                start,
                end,
                text: [b"(", written, b")"].concat().into_boxed_slice(),
            });
        }
        let mut last: Option<usize> = None;
        for index in 0..tokens.len() {
            if !kept[index] {
                continue;
            }
            if let Some(before) = last {
                let (left, right) = (tokens[before], tokens[index]);
                let has_space = match (left.kind, right.kind) {
                    (_, Kind::Comma) | (Kind::Open, _) | (_, Kind::Close) => false,
                    (Kind::OpenBrace, Kind::CloseBrace) => false,
                    (Kind::Comma | Kind::OpenBrace, _) | (_, Kind::CloseBrace) => true,
                    (_, Kind::Colon) | (Kind::Dots, _) => false,
                    (Kind::Colon | Kind::Equals | Kind::Arrow, _) => true,
                    (_, Kind::Equals | Kind::Arrow) => true,
                    (Kind::Word, Kind::Word) => true,
                    (Kind::Word, Kind::Open) => is_arrow,
                    (Kind::Star, Kind::Open) => true,
                    (Kind::Star, _) => before != 0,
                    _ => false,
                };
                let mut from = left.end as usize;
                for dropped in before + 1..index {
                    self.lay_gap(from, tokens[dropped].start as usize, false);
                    self.leave_out(tokens[dropped].start as usize, tokens[dropped].end as usize);
                    from = tokens[dropped].end as usize;
                }
                self.lay_gap(from, right.start as usize, has_space);
            }
            last = Some(index);
        }
        let end = tokens[last?].end as usize;
        self.tokens = tokens;
        self.lay_gap(end, body, true);
        Some(())
    }
}
