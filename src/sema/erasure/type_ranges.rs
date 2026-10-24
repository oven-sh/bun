use crate::atom::known;
use crate::hir::{
    Class, Expr, ExprId, ExprKind, File, Flags, Func, IdList, Member, MemberKind, ModifierKind,
    Param, PatId, PatKind, Span, StmtId, TypeNodeId, TypeParamId, end_of_expr, has_body,
    modifier_text, start_of,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct TypeRange {
    start: u32,
    end: u32,
    removed_before: u32,
}

#[derive(Default, PartialEq, Eq, Debug)]
pub struct TypeRanges(Vec<TypeRange>);

impl TypeRanges {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn remove_from(&self, text: &[u8]) -> Vec<u8> {
        let mut kept = Vec::with_capacity(text.len());
        let mut at = 0;
        for range in &self.0 {
            kept.extend_from_slice(&text[at..range.start as usize]);
            at = range.end as usize;
        }
        kept.extend_from_slice(&text[at..]);
        kept
    }

    pub fn map_offset(&self, offset: u32) -> u32 {
        let before = self.0.partition_point(|range| range.start < offset);
        match before.checked_sub(1).map(|last| self.0[last]) {
            Some(last) => offset - last.removed_before - (last.end.min(offset) - last.start),
            None => offset,
        }
    }
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
    let mut finder = Finder {
        file,
        text: &file.text,
        found: Vec::new(),
    };
    finder.run();
    let mut found = finder.found;
    found.sort_unstable();
    let mut merged: Vec<TypeRange> = Vec::with_capacity(found.len());
    for (start, end) in found {
        match merged.last_mut() {
            Some(last) if start <= last.end => last.end = last.end.max(end),
            last => {
                let removed_before = last.map_or(0, |it| it.removed_before + (it.end - it.start));
                merged.push(TypeRange {
                    start,
                    end,
                    removed_before,
                });
            }
        }
    }
    TypeRanges(merged)
}

struct Finder<'a, 's> {
    file: &'a File<'s>,
    text: &'a [u8],
    found: Vec<(u32, u32)>,
}

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
}

fn is_line_break(byte: u8) -> bool {
    matches!(byte, b'\n' | b'\r')
}

fn find_block_comment_at_end(text: &[u8]) -> Option<usize> {
    let before_close = text.strip_suffix(b"*/")?;
    bun_core::strings::last_index_of(before_close, b"/*")
}

fn find_line_comment_in_last_line(text: &[u8]) -> Option<usize> {
    let last_break = text.iter().rposition(|&byte| is_line_break(byte));
    let mut at = last_break.map_or(0, |line_break| line_break + 1);
    let mut quote = 0u8;
    while let Some(&byte) = text.get(at) {
        let rest = &text[at..];
        if quote != 0 {
            match byte {
                b'\\' => at += 1,
                _ if byte == quote => quote = 0,
                _ => {}
            }
        } else if rest.starts_with(b"//") {
            return Some(at);
        } else if rest.starts_with(b"/*") {
            let length = bun_core::strings::index_of(&rest[2..], b"*/");
            at += length.map_or(rest.len(), |length| length + 3);
        } else if matches!(byte, b'"' | b'\'' | b'`') {
            quote = byte;
        }
        at += 1;
    }
    None
}

impl Finder<'_, '_> {
    fn run(&mut self) {
        let file = self.file;
        for index in 0..file.stmts.len() {
            let statement = StmtId(index as u32);
            if file.is_erased_statement(statement) {
                let end = self.end_of_erased_statement(file[statement].loc.end as usize);
                self.add(file[statement].start, end as u32);
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
        for member in file.members.iter() {
            self.add_member(member);
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
            let rest = self.text.get(at..).unwrap_or_default();
            if rest.starts_with(b"//") {
                let length = rest.iter().position(|&byte| is_line_break(byte));
                at += length.unwrap_or(rest.len());
            } else if rest.starts_with(b"/*") {
                let length = bun_core::strings::index_of(&rest[2..], b"*/");
                at += length.map_or(rest.len(), |length| length + 4);
            } else {
                return at;
            }
        }
    }

    fn skip_trivia_back(&self, mut at: usize) -> usize {
        loop {
            let mut is_at_line_end = false;
            while is_space(self.byte_before(at)) {
                at -= 1;
                is_at_line_end |= is_line_break(self.byte(at));
            }
            let before = self.text.get(..at).unwrap_or_default();
            let line_comment = match is_at_line_end {
                true => find_line_comment_in_last_line(before),
                false => None,
            };
            match line_comment.or_else(|| find_block_comment_at_end(before)) {
                Some(comment_start) => at = comment_start,
                None => return at,
            }
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
        let mark = self.skip_trivia(name_end);
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

    fn add_member(&mut self, member: &Member) {
        let has_no_code = match member.kind {
            MemberKind::CallSignature
            | MemberKind::ConstructSignature
            | MemberKind::IndexSignature => true,
            MemberKind::Property | MemberKind::StaticBlock => false,
            _ => (member.func.some()).is_some_and(|function| !has_body(&self.file[function])),
        };
        if has_no_code || member.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT) {
            self.add(member.start, member.loc.end);
            return;
        }
        let annotation = self.find_annotation(member.ty);
        if let Some((start, end)) = annotation {
            self.add(start as u32, end as u32);
        }
        if member.flags.intersects(NAME_MARKS) {
            let after_mark = match annotation {
                Some((start, _)) => start,
                None => self.find_start_after_name(member),
            };
            self.add_mark_before(after_mark);
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
                b'>' => return self.add(open_end as u32 - 1, at as u32 + 1),
                _ => return,
            }
        }
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

    fn add_around_operand(&mut self, expression: &Expr, operand: ExprId) {
        let operand_start = start_of(self.file, operand);
        let is_prefix =
            self.byte(expression.pos as usize) == b'<' && expression.pos < operand_start;
        if !is_prefix {
            return self.add(end_of_expr(self.file, operand), expression.end);
        }
        let close_end = self.skip_trivia_back(operand_start as usize);
        if self.byte_before(close_end) == b'>' {
            self.add(expression.pos, close_end as u32);
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
