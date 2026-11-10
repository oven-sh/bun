use crate::atom::known;
use crate::hir::{
    BinOp, Class, ClassId, Comment, Expr, ExprId, ExprKind, File, Fixed, Flags, Func, IdList,
    Member, MemberKind, ModifierKind, Param, PatId, PatKind, Span, StmtId, StmtKind, TypeNodeId,
    TypeParamId, end_of_expr, find_runtime_constructor, find_super_call_statement, has_body,
    is_nested_namespace, is_parenthesized, modifier_text, parameter_properties, start_of,
};
use crate::session::Arena;
use std::cell::{Cell, RefCell};
use std::cmp::Reverse;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct TypeRange {
    start: u32,
    end: u32,
    added: u32,
    removed_before: i64,
}

impl TypeRange {
    fn removed_behind(self) -> i64 {
        self.removed_before + i64::from(self.end - self.start) - i64::from(self.added)
    }
}

pub struct ReplacedText {
    pub start: u32,
    pub end: u32,
    pub text: Box<[u8]>,
}

fn write_over(kept: &mut [u8], written_over: &[(u32, Box<[u8]>)]) {
    for (at, text) in written_over {
        kept[*at as usize..][..text.len()].copy_from_slice(text);
    }
}

#[derive(Default, PartialEq, Eq, Debug)]
pub struct TypeRanges {
    ranges: Vec<TypeRange>,
    written_over: Vec<(u32, Box<[u8]>)>,
}

impl TypeRanges {
    pub fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }

    #[cfg(any(test, feature = "test_support"))]
    pub fn remove_from(&self, text: &[u8]) -> Vec<u8> {
        let mut kept = Vec::with_capacity(text.len());
        let mut at = 0;
        for range in &self.ranges {
            kept.extend_from_slice(&text[at..range.start as usize]);
            kept.resize(kept.len() + range.added as usize, b' ');
            at = range.end as usize;
        }
        kept.extend_from_slice(&text[at..]);
        write_over(&mut kept, &self.written_over);
        kept
    }

    pub fn texts_written_over(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        (self.written_over.iter()).map(|(at, text)| (*at, *at + text.len() as u32))
    }

    pub fn removes(&self, offset: u32) -> bool {
        let next = self.ranges.partition_point(|range| range.end <= offset);
        (self.ranges.get(next)).is_some_and(|range| range.start <= offset)
    }

    pub fn pack(&self) -> PackedTypeRanges {
        let mut bytes = Vec::with_capacity(self.ranges.len() * 2);
        let mut at = 0;
        for range in &self.ranges {
            push_number(&mut bytes, range.start - at);
            push_number(&mut bytes, range.end - range.start);
            if range.start == range.end {
                push_number(&mut bytes, range.added);
            }
            at = range.end;
        }
        PackedTypeRanges {
            bytes: bytes.into_boxed_slice(),
            removed: self.ranges.last().map_or(0, |last| last.removed_behind()),
            written_over: self.written_over.clone().into_boxed_slice(),
        }
    }

    pub fn map_offset(&self, offset: u32) -> u32 {
        self.map(
            offset,
            self.ranges.partition_point(|range| range.start < offset),
        )
    }

    pub fn map_start(&self, offset: u32) -> u32 {
        self.map_end(offset)
    }

    pub fn map_end(&self, offset: u32) -> u32 {
        self.map(
            offset,
            self.ranges.partition_point(|range| range.start <= offset),
        )
    }

    fn map(&self, offset: u32, before: usize) -> u32 {
        match before.checked_sub(1).map(|last| self.ranges[last]) {
            Some(last) => {
                let in_range = i64::from(last.end.min(offset) - last.start) - i64::from(last.added);
                (i64::from(offset) - last.removed_before - in_range) as u32
            }
            None => offset,
        }
    }
}

#[derive(Default, Clone, PartialEq, Eq, Debug)]
pub struct PackedTypeRanges {
    bytes: Box<[u8]>,
    removed: i64,
    written_over: Box<[(u32, Box<[u8]>)]>,
}

impl PackedTypeRanges {
    pub fn kept_len(&self, len_of_text: usize) -> usize {
        (len_of_text as i64 - self.removed) as usize
    }

    pub fn remove_from(&self, text: &[u8], kept: &mut [u8]) {
        let (mut bytes, mut at, mut written) = (&self.bytes[..], 0, 0);
        let mut keep = |part: &[u8], added_behind: usize| {
            kept[written..written + part.len()].copy_from_slice(part);
            written += part.len() + added_behind;
        };
        while !bytes.is_empty() {
            let start = at + take_number(&mut bytes) as usize;
            let removed = take_number(&mut bytes) as usize;
            let added = match removed {
                0 => take_number(&mut bytes) as usize,
                _ => 0,
            };
            keep(&text[at..start], added);
            at = start + removed;
        }
        keep(&text[at..], 0);
        write_over(kept, &self.written_over);
    }
}

fn push_number(bytes: &mut Vec<u8>, mut number: u32) {
    while number >= 0x80 {
        bytes.push(number as u8 | 0x80);
        number >>= 7;
    }
    bytes.push(number as u8);
}

fn take_number(bytes: &mut &[u8]) -> u32 {
    let (mut number, mut shift) = (0, 0);
    while let Some((&byte, rest)) = bytes.split_first() {
        *bytes = rest;
        number |= u32::from(byte & 0x7f) << shift;
        shift += 7;
        if byte < 0x80 {
            break;
        }
    }
    number
}

const TYPE_MODIFIERS: Flags = Flags::ABSTRACT
    .union(Flags::AMBIENT)
    .union(Flags::IN)
    .union(Flags::OUT)
    .union(Flags::OVERRIDE)
    .union(Flags::PRIVATE)
    .union(Flags::PROTECTED)
    .union(Flags::PUBLIC)
    .union(Flags::READONLY);

const NAME_MARKS: Flags = Flags::OPTIONAL.union(Flags::DEFINITE);

pub fn find_type_ranges(file: &File<'_>) -> TypeRanges {
    find_type_ranges_beside(file, Vec::new())
}

pub fn keep_only_comments_beside_types_and<'s>(
    file: &mut File<'s>,
    arena: &'s Arena,
    is_read_later: fn(&[u8]) -> bool,
) {
    let mut passed = Vec::new();
    if !file.is_js && !file.comments.is_empty() {
        let mut finder = Finder::new(file);
        finder.run();
        passed = finder.comments_passed.into_inner();
    }
    for (index, comment) in file.comments.iter().enumerate() {
        let text = file.text.get(comment.pos as usize..comment.end as usize);
        if text.is_some_and(is_read_later) {
            passed.push(index as u32);
        }
    }
    passed.sort_unstable();
    passed.dedup();
    let kept: Vec<Comment> = (passed.iter())
        .map(|&index| file.comments[index as usize])
        .collect();
    file.comments = Fixed::copied_in(arena, &kept);
}

pub fn find_type_ranges_beside(file: &File<'_>, replaced: Vec<ReplacedText>) -> TypeRanges {
    find_type_ranges_beside_what_is_laid(file, replaced, |_, _| {})
}

pub fn find_type_ranges_beside_what_is_laid(
    file: &File<'_>,
    mut replaced: Vec<ReplacedText>,
    lay: impl FnOnce(&[(u32, u32)], &mut Vec<ReplacedText>),
) -> TypeRanges {
    let mut finder = Finder::new(file);
    if !file.is_js {
        finder.run();
    }
    finder.found.sort_unstable();
    lay(&finder.found, &mut replaced);
    finder.leave_what_stands_in(&mut replaced);
    replaced.append(&mut finder.replaced);
    for part in &replaced {
        finder.add(part.start + part.text.len() as u32, part.end);
    }
    let mut found = finder.found;
    found.sort_unstable();
    let mut removed: Vec<(u32, u32)> = Vec::with_capacity(found.len());
    for (start, end) in found {
        match removed.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => removed.push((start, end)),
        }
    }
    let mut ends_of_statements = finder.ends_of_statements;
    ends_of_statements.sort_unstable();
    let mut last_written = None;
    for at in ends_of_statements {
        let next = removed.partition_point(|range| range.1 <= at);
        if last_written != Some(next)
            && let Some(range) = removed.get_mut(next).filter(|range| range.0 <= at)
        {
            range.1 -= 1;
            replaced.push(ReplacedText {
                start: range.1,
                end: range.1 + 1,
                text: Box::new(*b";"),
            });
            last_written = Some(next);
        }
    }
    removed.retain(|range| range.0 < range.1);
    let is_kept = |part: &ReplacedText| {
        let start = part.start;
        let end = part.end.min(start + part.text.len() as u32);
        let next =
            removed.partition_point(|range| range.1 < start || (range.1 == start && start < end));
        !part.text.is_empty() && removed.get(next).is_none_or(|range| end <= range.0)
    };
    let mut replaced: Vec<ReplacedText> = replaced.into_iter().filter(is_kept).collect();
    replaced.sort_unstable_by_key(|part| (part.start, part.end));
    replaced.dedup_by_key(|part| (part.start, part.end));
    let added = replaced.iter().filter_map(|part| {
        let added = (part.text.len() as u32).checked_sub(part.end - part.start)?;
        (added > 0).then_some((part.end, part.end, added))
    });
    let mut ranges: Vec<(u32, u32, u32)> = (removed.iter())
        .map(|&(start, end)| (start, end, 0))
        .chain(added)
        .collect();
    ranges.sort_unstable_by_key(|&(start, end, _)| (start, end));
    let mut removed_before = 0;
    let ranges = ranges.into_iter().map(|(start, end, added)| {
        let range = TypeRange {
            start,
            end,
            added,
            removed_before,
        };
        removed_before = range.removed_behind();
        range
    });
    let mut ranges = TypeRanges {
        ranges: ranges.collect(),
        written_over: Vec::new(),
    };
    let written_over = replaced.into_iter().map(|part| {
        let at = match part.start == part.end {
            true => ranges.map_offset(part.start),
            false => ranges.map_start(part.start),
        };
        (at, part.text)
    });
    ranges.written_over = written_over.collect();
    ranges
}

struct Finder<'a, 's> {
    file: &'a File<'s>,
    text: &'a [u8],
    found: Vec<(u32, u32)>,
    replaced: Vec<ReplacedText>,
    ends_of_statements: Vec<u32>,
    comments_passed: RefCell<Vec<u32>>,
    comments_before_last_asked: Cell<usize>,
}

fn is_part_of_name(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$') || byte >= 0x80
}

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
}

fn is_line_break(byte: u8) -> bool {
    matches!(byte, b'\n' | b'\r')
}

impl<'a, 's> Finder<'a, 's> {
    fn new(file: &'a File<'s>) -> Self {
        Finder {
            file,
            text: &file.text,
            found: Vec::new(),
            replaced: Vec::new(),
            ends_of_statements: Vec::new(),
            comments_passed: RefCell::default(),
            comments_before_last_asked: Cell::new(0),
        }
    }

    fn run(&mut self) {
        let file = self.file;
        for index in 0..file.stmts.len() {
            let statement = StmtId(index as u32);
            if file.is_erased_statement(statement) && !is_nested_namespace(file, statement) {
                let end = self.end_of_erased_statement(file[statement].loc.end as usize);
                self.add_whole(file[statement].start, end as u32);
            }
            let bodies = match file[statement].kind {
                StmtKind::If { yes, no, .. } => [yes, no],
                StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. }
                | StmtKind::Labeled { body, .. }
                | StmtKind::With { body, .. } => [body, StmtId::NONE],
                _ => continue,
            };
            for body in bodies.into_iter().filter_map(StmtId::some) {
                if file.is_erased_statement(body) {
                    self.ends_of_statements.push(file[body].start);
                }
            }
        }
        for declaration in file.var_decls.iter() {
            let is_definite = declaration.flags.contains(Flags::DEFINITE);
            self.add_annotation(declaration.pat, declaration.ty, is_definite);
        }
        for parameter in file.params.iter() {
            self.add_parameter(parameter);
        }
        for function in file.fns.iter() {
            self.add_function(function);
        }
        for class in file.classes.iter() {
            self.add_class(class);
        }
        if !file.modifiers_of_params.is_empty() {
            for index in 0..file.classes.len() {
                self.add_parameter_properties(ClassId(index as u32));
            }
        }
        for class in file.classes.iter() {
            for member in &file.members[class.members.range()] {
                self.add_member(member);
            }
        }
        for specifier in file.import_specs.iter().filter(|it| it.type_only) {
            self.add_list_element(specifier.start, specifier.end);
        }
        for specifier in file.export_specs.iter().filter(|it| it.type_only) {
            self.add_list_element(specifier.start, specifier.end);
        }
        for call in file.calls.iter() {
            self.add_type_arguments(file.list_at(call.type_args));
        }
        for element in file.jsx.iter() {
            self.add_type_arguments(element.type_args);
        }
        for expression in file.exprs.iter() {
            self.add_expression(expression);
        }
        for modifier in file.modifiers.iter() {
            if let ModifierKind::Keyword(flag) = modifier.kind
                && TYPE_MODIFIERS.contains(flag)
            {
                let end = modifier.pos as usize + modifier_text(flag).len();
                self.add(modifier.pos, self.skip_spaces(end) as u32);
            }
        }
    }

    fn leave_what_stands_in(&mut self, replaced: &mut Vec<ReplacedText>) {
        if replaced.is_empty() {
            return;
        }
        replaced.sort_unstable_by_key(|part| {
            let is_written_over = part.start < part.end;
            (part.start, is_written_over, Reverse(part.end))
        });
        replaced.dedup_by_key(|part| (part.start, part.end));
        let mut outermost: Vec<ReplacedText> = Vec::with_capacity(replaced.len());
        for part in replaced.drain(..) {
            match outermost.last_mut() {
                Some(last) if part.start < last.end => {}
                Some(last) if part.end == last.end => {
                    last.text = [&last.text[..], &part.text[..]].concat().into();
                }
                _ => outermost.push(part),
            }
        }
        *replaced = outermost;
        let stands_in_part = |start: u32, end: u32| {
            let behind = replaced.partition_point(|part| part.start < end);
            let last = behind.checked_sub(1).map(|last| &replaced[last]);
            last.is_some_and(|part| part.start <= start && end <= part.end)
        };
        self.found
            .retain(|&(start, end)| !stands_in_part(start, end));
        self.replaced
            .retain(|part| !stands_in_part(part.start, part.end));
        self.ends_of_statements
            .retain(|&at| !stands_in_part(at, at + 1));
    }

    fn end_of_erased_statement(&self, end: usize) -> usize {
        if self.byte_before(end) != b';' {
            return end;
        }
        let last_token_end = self.skip_trivia_back(end - 1);
        let between = self.text.get(last_token_end..end - 1).unwrap_or_default();
        match between.iter().any(|&byte| is_line_break(byte)) {
            true => last_token_end,
            false => end,
        }
    }

    fn add(&mut self, start: u32, end: u32) {
        if start < end && end as usize <= self.text.len() {
            self.found.push((start, end));
        }
    }

    fn add_list_element(&mut self, start: u32, end: u32) {
        let comma = self.skip_trivia(end as usize);
        match self.byte(comma) {
            b',' => self.add(start, self.skip_spaces(comma + 1) as u32),
            _ => self.add(start, end),
        }
    }

    fn byte(&self, at: usize) -> u8 {
        self.text.get(at).copied().unwrap_or(0)
    }

    fn byte_before(&self, at: usize) -> u8 {
        at.checked_sub(1).map_or(0, |before| self.byte(before))
    }

    fn skip_spaces(&self, mut at: usize) -> usize {
        while is_space(self.byte(at)) {
            at += 1;
        }
        at
    }

    fn skip_trivia(&self, mut at: usize) -> usize {
        loop {
            at = self.skip_spaces(at);
            if self.byte(at) != b'/' {
                return at;
            }
            let rest = self.text.get(at..).unwrap_or_default();
            match self.byte(at + 1) {
                b'/' => {
                    let length = rest.iter().position(|&byte| is_line_break(byte));
                    at += length.unwrap_or(rest.len());
                }
                b'*' => {
                    let length = bun_core::strings::index_of(&rest[2..], b"*/");
                    at += length.map_or(rest.len(), |length| length + 4);
                }
                _ => return at,
            }
        }
    }

    fn count_comments_before(&self, at: usize) -> usize {
        let comments = &self.file.comments;
        let starts_before = |comment: &Comment| (comment.pos as usize) < at;
        let last_asked = self.comments_before_last_asked.get();
        let last = last_asked.checked_sub(1).map(|last| &comments[last]);
        let next = comments.get(last_asked);
        if last.is_none_or(starts_before) && !next.is_some_and(starts_before) {
            return last_asked;
        }
        let before = comments.partition_point(starts_before);
        self.comments_before_last_asked.set(before);
        before
    }

    fn skip_trivia_back(&self, mut at: usize) -> usize {
        let comments = &self.file.comments;
        loop {
            while is_space(self.byte_before(at)) {
                at -= 1;
            }
            let before = self.count_comments_before(at);
            match before.checked_sub(1) {
                Some(last) if comments[last].end as usize >= at => {
                    self.comments_passed.borrow_mut().push(last as u32);
                    at = comments[last].pos as usize;
                }
                _ => return at,
            }
        }
    }

    fn has_line_break(&self, from: usize, to: usize) -> bool {
        let between = self.text.get(from..to).unwrap_or_default();
        between.iter().any(|&byte| is_line_break(byte))
    }

    fn is_followed_by_one_of(&self, end: usize, bytes: &[u8]) -> bool {
        bytes.contains(&self.byte(self.skip_trivia(end)))
    }

    fn is_followed_by_operator_word(&self, end: usize) -> bool {
        let rest = self.text.get(self.skip_trivia(end)..).unwrap_or_default();
        [&b"instanceof"[..], b"in"].iter().any(|&word| {
            (rest.strip_prefix(word))
                .is_some_and(|behind| !behind.first().is_some_and(|&byte| is_part_of_name(byte)))
        })
    }

    fn add_whole(&mut self, start: u32, end: u32) {
        self.add(start, end);
        let end = self.skip_trivia(end as usize);
        if self.is_followed_by_one_of(end, b"([`+-/<*") || self.is_followed_by_operator_word(end) {
            self.ends_of_statements.push(start);
        }
    }

    fn skip_closing_parentheses(&self, mut end: usize, count: usize) -> Option<usize> {
        for _ in 0..count {
            let at = self.skip_trivia(end);
            if self.byte(at) != b')' {
                return None;
            }
            end = at + 1;
        }
        Some(end)
    }

    fn skip_opening_parentheses_back(&self, start: usize) -> (usize, usize) {
        let (mut at, mut count) = (self.skip_trivia_back(start), 0);
        while self.byte_before(at) == b'(' {
            at = self.skip_trivia_back(at - 1);
            count += 1;
        }
        (at, count)
    }

    fn find_annotation(&self, ty: TypeNodeId) -> Option<(usize, usize)> {
        let ty = self.file[ty.some()?];
        let (colon_end, count) = self.skip_opening_parentheses_back(ty.pos as usize);
        if self.byte_before(colon_end) != b':' {
            return None;
        }
        let end = self.skip_closing_parentheses(ty.end as usize, count)?;
        Some((self.skip_trivia_back(colon_end - 1), end))
    }

    fn add_annotation(&mut self, name: PatId, ty: TypeNodeId, has_mark: bool) {
        let Some(name) = name.some() else {
            return;
        };
        let name_end = self.file[name].end as usize;
        let mark = match has_mark {
            true => self.skip_trivia(name_end),
            false => name_end,
        };
        let mark_end = match has_mark && matches!(self.byte(mark), b'?' | b'!') {
            true => mark + 1,
            false => name_end,
        };
        match self.find_annotation(ty) {
            Some((start, end)) if start == mark_end => self.add(name_end as u32, end as u32),
            None if ty.is_none() => self.add(name_end as u32, mark_end as u32),
            Some(_) | None => {}
        }
    }

    fn add_mark_before(&mut self, at: usize) {
        let end = self.skip_trivia_back(at);
        if matches!(self.byte_before(end), b'?' | b'!') {
            self.add(self.skip_trivia_back(end - 1) as u32, end as u32);
        }
    }

    fn add_parameter(&mut self, parameter: &Param) {
        let is_optional = parameter.flags.contains(Flags::OPTIONAL);
        self.add_annotation(parameter.pat, parameter.ty, is_optional);
        let Some(name) = parameter.pat.some().map(|name| self.file[name]) else {
            return;
        };
        if !matches!(name.kind, PatKind::Ident(known::this)) {
            return;
        }
        let end = match self.find_annotation(parameter.ty) {
            Some((_, end)) => end as u32,
            None if parameter.ty.is_none() => name.end,
            None => return,
        };
        self.add_list_element(parameter.pos, end);
    }

    fn add_function(&mut self, function: &Func) {
        self.add_type_parameters(function.type_params);
        if let Some((start, end)) = self.find_annotation(function.ret) {
            self.add(start as u32, end as u32);
        }
    }

    fn add_class(&mut self, class: &Class) {
        self.add_type_parameters(class.type_params);
        self.add_type_arguments(class.extends_args);
        let file = self.file;
        let Some(first) = file.ids(class.implements).next() else {
            return;
        };
        let keyword_end = self.skip_trivia_back(file[first].pos as usize);
        let keyword = b"implements";
        if !(self.text.get(..keyword_end).unwrap_or_default()).ends_with(keyword) {
            return;
        }
        let start = self.skip_trivia_back(keyword_end - keyword.len());
        let implemented = file
            .ids(class.implements)
            .chain(file.ids(class.other_implements));
        let end = implemented.map(|ty| file[ty].end).max().unwrap_or_default();
        self.add(start as u32, end);
    }

    fn add_parameter_properties(&mut self, class: ClassId) {
        let file = self.file;
        let Some(constructor) = find_runtime_constructor(file, class) else {
            return;
        };
        let constructor = file[constructor].func;
        let (mut fields, mut stores) = (Vec::new(), Vec::new());
        for parameter in parameter_properties(file, constructor) {
            let name = file[file[parameter].pat];
            let Some(name) = self.text.get(name.pos as usize..name.end as usize) else {
                return;
            };
            fields.extend([name, b"; "].concat());
            stores.extend([&b" this."[..], name, b" = ", name, b";"].concat());
        }
        if fields.is_empty() {
            return;
        }
        let bodies = &file.body_starts;
        let Ok(body) = bodies.binary_search_by_key(&constructor.0, |body| body.0.0) else {
            return;
        };
        let super_call = match file[class].extends.is_some() {
            true => find_super_call_statement(file, constructor),
            false => None,
        };
        let stores_at = match super_call {
            Some((statement, _)) => file[statement].loc.end,
            None => bodies[body].1 + 1,
        };
        if super_call.is_some() && self.byte_before(stores_at as usize) != b';' {
            stores.insert(0, b';');
        }
        let first_member = file.members[file[class].members.start as usize];
        for (at, text) in [(first_member.start, fields), (stores_at, stores)] {
            self.replaced.push(ReplacedText {
                start: at,
                end: at,
                text: text.into_boxed_slice(),
            });
        }
    }

    fn add_member(&mut self, member: &Member) {
        let has_no_code = match member.kind {
            MemberKind::CallSignature
            | MemberKind::ConstructSignature
            | MemberKind::IndexSignature => true,
            MemberKind::Property | MemberKind::StaticBlock => false,
            _ => (member.func.some()).is_some_and(|function| !has_body(&self.file[function])),
        };
        if has_no_code || member.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT) {
            self.add_whole(member.start, member.loc.end);
            return;
        }
        let file = self.file;
        for modifier in &file.modifiers[member.modifiers.range()] {
            let ModifierKind::Keyword(flag) = modifier.kind else {
                break;
            };
            if !TYPE_MODIFIERS.contains(flag) {
                break;
            }
            let end = modifier.pos as usize + modifier_text(flag).len();
            if self.is_followed_by_one_of(end, b"[*") || self.is_followed_by_operator_word(end) {
                self.ends_of_statements.push(modifier.pos);
            }
        }
        let annotation = self.find_annotation(member.ty);
        if let Some((start, end)) = annotation {
            self.add(start as u32, end as u32);
        }
        let after_mark = match annotation {
            Some((start, _)) => start,
            None => self.find_start_after_name(member),
        };
        if member.flags.intersects(NAME_MARKS) {
            self.add_mark_before(after_mark);
        }
        self.add_end_of_field_named_like_modifier(member, after_mark);
    }

    fn add_end_of_field_named_like_modifier(&mut self, member: &Member, after_mark: usize) {
        if !matches!(member.kind, MemberKind::Property) || member.init.some().is_some() {
            return;
        }
        let mut name_end = self.skip_trivia_back(after_mark);
        if matches!(self.byte_before(name_end), b'?' | b'!') {
            name_end = self.skip_trivia_back(name_end - 1);
        }
        let before = self.text.get(..name_end).unwrap_or_default();
        if !matches!(before.last(), Some(b'c' | b't')) {
            return;
        }
        let is_named_like_modifier = [&b"static"[..], b"get", b"set"].iter().any(|&word| {
            (before.strip_suffix(word))
                .is_some_and(|front| !front.last().is_some_and(|&byte| is_part_of_name(byte)))
        });
        let end = member.loc.end as usize;
        if is_named_like_modifier
            && self.byte_before(end) != b';'
            && !self.is_followed_by_one_of(end, b";}")
        {
            self.ends_of_statements.push(name_end as u32);
        }
    }

    fn find_start_after_name(&self, member: &Member) -> usize {
        let file = self.file;
        if let Some(function) = member.func.some() {
            let function = &file[function];
            return match function.type_params.iter().next() {
                Some(first) => self
                    .skip_trivia_back(file[first].start as usize)
                    .saturating_sub(1),
                None => function.anchor as usize,
            };
        }
        if let Some(initializer) = member.init.some() {
            let equals_end = self.skip_trivia_back(start_of(file, initializer) as usize);
            return equals_end.saturating_sub(1);
        }
        let end = member.loc.end as usize;
        end - usize::from(self.byte_before(end) == b';')
    }

    fn add_angle_brackets(&mut self, first_start: u32, last_end: u32) {
        let (open_end, _) = self.skip_opening_parentheses_back(first_start as usize);
        if self.byte_before(open_end) != b'<' {
            return;
        }
        let mut end = last_end as usize;
        loop {
            let at = self.skip_trivia(end);
            match self.byte(at) {
                b')' | b',' => end = at + 1,
                b'>' => {
                    end = at + 1;
                    break;
                }
                _ => return,
            }
        }
        let next = self.skip_trivia(end);
        if self.byte(next) == b'(' && self.has_line_break(end, next) {
            end = next;
        }
        self.add(open_end as u32 - 1, end as u32);
    }

    fn add_type_arguments(&mut self, arguments: IdList<TypeNodeId>) {
        let mut arguments = self.file.ids(arguments);
        let Some(first) = arguments.next() else {
            return;
        };
        let last = arguments.next_back().unwrap_or(first);
        self.add_angle_brackets(self.file[first].pos, self.file[last].end);
    }

    fn add_type_parameters(&mut self, parameters: Span<TypeParamId>) {
        let mut parameters = parameters.iter();
        let Some(first) = parameters.next() else {
            return;
        };
        let last = parameters.last().unwrap_or(first);
        self.add_angle_brackets(self.file[first].start, self.file[last].end);
    }

    fn find_operand_that_binds_looser(&self, mut operand: ExprId, end: usize) -> Option<ExprId> {
        let behind = match self.text.get(self.skip_trivia(end)..).unwrap_or_default() {
            [b'*', b'*', ..] => 5,
            [b'*' | b'/' | b'%', ..] => 4,
            [b'+' | b'-', ..] => 3,
            [b'<', b'<', ..] | [b'>', b'>', ..] => 2,
            _ => return None,
        };
        while !is_parenthesized(self.file, operand)
            && let ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr) = self.file[operand].kind
        {
            operand = expr;
        }
        let ExprKind::Binary { op, .. } = self.file[operand].kind else {
            return None;
        };
        let own = match op {
            BinOp::Pow => 4,
            BinOp::Mul | BinOp::Div | BinOp::Rem => 4,
            BinOp::Add | BinOp::Sub => 3,
            BinOp::Shl | BinOp::Shr | BinOp::UShr => 2,
            _ => 1,
        };
        (own < behind && !is_parenthesized(self.file, operand)).then_some(operand)
    }

    fn add_around_operand(&mut self, expression: &Expr, operand: ExprId) {
        let operand_start = start_of(self.file, operand);
        let is_prefix =
            self.byte(expression.pos as usize) == b'<' && expression.pos < operand_start;
        if !is_prefix {
            let start = end_of_expr(self.file, operand);
            match self.find_operand_that_binds_looser(operand, expression.end as usize) {
                Some(looser) => {
                    let open = start_of(self.file, looser);
                    self.replaced.push(ReplacedText {
                        start: open,
                        end: open,
                        text: Box::new(*b"("),
                    });
                    self.replaced.push(ReplacedText {
                        start,
                        end: expression.end,
                        text: Box::new(*b")"),
                    });
                }
                None => self.add(start, expression.end),
            }
            if self.is_followed_by_one_of(expression.end as usize, b"([`") {
                self.ends_of_statements.push(start);
            }
            return;
        }
        let mut close_end = self.skip_trivia_back(operand_start as usize);
        if self.byte_before(close_end) != b'>' {
            return;
        }
        if self.has_line_break(close_end, operand_start as usize) {
            close_end = operand_start as usize;
        }
        let rest = &self.text[operand_start as usize..];
        let begins_statement = [&b"{"[..], b"function", b"class", b"async"]
            .iter()
            .any(|start| rest.starts_with(start));
        let joins_names = close_end == operand_start as usize
            && is_part_of_name(self.byte_before(expression.pos as usize))
            && rest.first().is_some_and(|&byte| is_part_of_name(byte));
        if !begins_statement && !joins_names {
            return self.add(expression.pos, close_end as u32);
        }
        self.replaced.push(ReplacedText {
            start: expression.pos,
            end: close_end as u32,
            text: Box::new([if begins_statement { b'(' } else { b' ' }]),
        });
        if begins_statement {
            let end = end_of_expr(self.file, operand);
            self.replaced.push(ReplacedText {
                start: end,
                end,
                text: Box::new(*b")"),
            });
        }
    }

    fn add_expression(&mut self, expression: &Expr) {
        match expression.kind {
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::Instantiation { expr, .. } => self.add_around_operand(expression, expr),
            ExprKind::NonNull(operand) => {
                self.add(end_of_expr(self.file, operand), expression.end);
            }
            _ => {}
        }
    }
}
