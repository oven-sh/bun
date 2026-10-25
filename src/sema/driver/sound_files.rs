use bstr::BStr;
use bun_ast::op::Level;
use bun_sema::atom::Interner;
use bun_sema::check::Checker;
use bun_sema::check::services::{
    Child, NodeRef, Services, SymbolFlags, SymbolOp, SymbolRef, SymbolTable, TypeFlags,
    TypeFormatFlags,
};
use bun_sema::check::spans::{compute_ecma_line_starts, skip_trivia, skip_trivia_back, token_end};
use bun_sema::config::find_config_of_package;
use bun_sema::hir::*;
use bun_sema::json::Json;
use bun_sema::program::FileId;
use bun_sema::resolve::{Dialect, ScriptKind};
use bun_sema::session::Session;
use bun_sema::types::TypeId;
use bun_sema::util::{FxHashMap, FxHashSet};

struct Source<'a> {
    path: &'a [u8],
    text: &'a [u8],
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
enum Place {
    Binding,
    TypeParameters,
    ThisParameter,
    ReturnType,
    ClassKeyword,
    ClassTypeParameters,
    ExtendsTypeArguments,
    Implements,
    MemberStart,
    MemberName,
    MemberType,
    TypeArguments,
}

#[derive(Copy, Clone, Debug)]
struct Slot {
    place: Place,
    key: u32,
    start: u32,
    end: u32,
}

impl Slot {
    fn new(place: Place, key: u32, (start, end): (u32, u32)) -> Slot {
        Slot {
            place,
            key,
            start,
            end,
        }
    }
}

fn level_of_operator(op: BinOp) -> Level {
    match op {
        BinOp::Comma => Level::Comma,
        BinOp::Nullish => Level::NullishCoalescing,
        BinOp::Or => Level::LogicalOr,
        BinOp::And => Level::LogicalAnd,
        BinOp::BitOr => Level::BitwiseOr,
        BinOp::BitXor => Level::BitwiseXor,
        BinOp::BitAnd => Level::BitwiseAnd,
        BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => Level::Equals,
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::In | BinOp::Instanceof => {
            Level::Compare
        }
        BinOp::Shl | BinOp::Shr | BinOp::UShr => Level::Shift,
        BinOp::Add | BinOp::Sub => Level::Add,
        BinOp::Mul | BinOp::Div | BinOp::Rem => Level::Multiply,
        BinOp::Pow => Level::Exponentiation,
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
enum Shape {
    Leaf,
    Dot,
    Index,
    Call,
    New,
    Prefix,
    Postfix,
    Binary,
    Conditional,
}

struct CastChain {
    operand: ExprId,
    outermost: ExprId,
    casts: Vec<ExprId>,
}

struct Context {
    required: Vec<Level>,
    parent: Vec<ExprId>,
    is_before_operator: Vec<bool>,
}

struct Syntax<'a, 's> {
    file: &'a File<'s>,
    text: &'a [u8],
}

fn is_blank(bytes: &[u8]) -> bool {
    bytes.iter().all(|byte| matches!(byte, b' ' | b'\t'))
}

fn line_start(text: &[u8], at: usize) -> usize {
    bun_core::strings::last_index_of_char(&text[..at], b'\n').map_or(0, |newline| newline + 1)
}

fn is_inside(sorted_ranges: &[(u32, u32)], at: u32) -> bool {
    let until = sorted_ranges.partition_point(|range| range.0 <= at);
    sorted_ranges[..until]
        .last()
        .is_some_and(|range| at < range.1)
}

fn is_covered(sorted_ranges: &[(u32, u32)], start: u32, end: u32) -> bool {
    let until = sorted_ranges.partition_point(|range| range.0 <= start);
    sorted_ranges[..until]
        .last()
        .is_some_and(|range| end <= range.1)
}

fn merged(mut ranges: Vec<(u32, u32)>) -> Vec<(u32, u32)> {
    ranges.sort_unstable();
    let mut merged: Vec<(u32, u32)> = Vec::new();
    for range in ranges {
        match merged.last_mut() {
            Some(last) if range.0 < last.1 => last.1 = last.1.max(range.1),
            _ => merged.push(range),
        }
    }
    merged
}

fn is_typescript(path: &[u8]) -> bool {
    [&b".ts"[..], b".tsx", b".mts", b".cts"]
        .iter()
        .any(|extension| path.ends_with(extension))
}

fn parse<'s>(
    session: &'s Session,
    atoms: &Interner<'s>,
    path: &[u8],
    text: &[u8],
) -> Result<File<'s>, String> {
    let kind = if path.ends_with(b".tsx") {
        ScriptKind::Tsx
    } else {
        ScriptKind::Ts
    };
    let file = bun_sema_parser::summarize_as(
        Dialect::default(),
        session.arena(),
        path,
        Some(kind),
        text,
        atoms,
        false,
        true,
    );
    match file.has_errors || file.has_parse_diagnostics || file.ran_out_of_stack {
        true => Err(format!(
            "{} does not parse as TypeScript (offset {})",
            BStr::new(path),
            file.diagnostics
                .first()
                .map_or(file.error_pos, |first| first.start)
        )),
        false => Ok(file),
    }
}

impl<'a, 's> Syntax<'a, 's> {
    fn after_trivia(&self, at: u32) -> u32 {
        skip_trivia(self.text, at as usize) as u32
    }

    fn before_trivia(&self, at: u32) -> u32 {
        skip_trivia_back(self.text, at as usize) as u32
    }

    fn byte(&self, at: u32) -> u8 {
        self.text.get(at as usize).copied().unwrap_or(0)
    }

    fn token_end(&self, at: u32) -> u32 {
        token_end(self.text, at as usize, false) as u32
    }

    fn parentheses(&self, expr: ExprId) -> &'a [(ExprId, u32, u32)] {
        parentheses_around(self.file, expr)
    }

    fn outer_span(&self, expr: ExprId) -> (u32, u32) {
        match self.parentheses(expr).last() {
            Some(&(_, start, end)) => (start, end),
            None => (self.file[expr].pos, self.file[expr].end),
        }
    }

    fn type_span(&self, node: TypeNodeId) -> (u32, u32) {
        let (mut start, mut end) = (self.file[node].pos, self.file[node].end);
        loop {
            let (before, after) = (self.before_trivia(start), self.after_trivia(end));
            if before == 0 || self.byte(before - 1) != b'(' || self.byte(after) != b')' {
                return (start, end);
            }
            (start, end) = (before - 1, after + 1);
        }
    }

    fn angle_brackets(&self, first_start: u32, last_end: u32) -> (u32, u32) {
        let open = self.before_trivia(first_start).saturating_sub(1);
        let mut close = self.after_trivia(last_end);
        if self.byte(close) == b',' {
            close = self.after_trivia(close + 1);
        }
        (open, close + 1)
    }

    fn type_parameters_span(&self, list: Span<TypeParamId>) -> Option<(u32, u32)> {
        let (first, last) = (list.iter().next()?, list.iter().next_back()?);
        Some(self.angle_brackets(self.file[first].start, self.file[last].end))
    }

    fn type_arguments_span(&self, list: IdList<TypeNodeId>) -> Option<(u32, u32)> {
        let mut nodes = self.file.ids(list);
        let first = nodes.next()?;
        let last = nodes.next_back().unwrap_or(first);
        Some(self.angle_brackets(self.type_span(first).0, self.type_span(last).1))
    }

    fn first_identifier(&self, pattern: PatId) -> Option<u32> {
        let node = self.file.pats.get(pattern.idx())?;
        match node.kind {
            PatKind::Missing => None,
            PatKind::Ident(_) => Some(node.pos),
            PatKind::Object(properties) => properties
                .iter()
                .find_map(|property| self.first_identifier(self.file[property].value)),
            PatKind::Array(elements) => elements
                .iter()
                .find_map(|element| self.first_identifier(self.file[element].pat)),
        }
    }

    fn body_start(&self, function: FnId) -> Option<u32> {
        let bodies = &self.file.body_starts;
        bodies
            .binary_search_by_key(&function.0, |body| body.0.0)
            .ok()
            .map(|at| bodies[at].1)
    }

    fn has_javascript(function: &Func) -> bool {
        function.kind != FnKind::StaticBlock && has_body(function)
    }

    fn open_parenthesis(&self, function: &Func) -> Option<u32> {
        if function.kind != FnKind::Arrow {
            return Some(function.anchor);
        }
        let mut at = function.start;
        if function.flags.contains(Flags::ASYNC) {
            at = self.after_trivia(at + 5);
        }
        if let Some((_, end)) = self.type_parameters_span(function.type_params) {
            at = self.after_trivia(end);
        }
        (self.byte(at) == b'(').then_some(at)
    }

    fn function_key(function: &Func) -> u32 {
        if function.kind == FnKind::Arrow {
            function.start
        } else {
            function.anchor
        }
    }

    fn binding_slot(
        &self,
        pattern: PatId,
        annotation: TypeNodeId,
        is_optional: bool,
    ) -> Option<Slot> {
        let key = self.first_identifier(pattern)?;
        let start = self.file[pattern].end;
        let end = match annotation.some() {
            Some(annotation) => self.type_span(annotation).1,
            None if is_optional && self.byte(self.after_trivia(start)) == b'?' => {
                self.after_trivia(start) + 1
            }
            None => start,
        };
        Some(Slot::new(Place::Binding, key, (start, end)))
    }

    fn function_slots(&self, id: FnId, slots: &mut Vec<Slot>) {
        let function = &self.file[id];
        let Some(open) = self
            .open_parenthesis(function)
            .filter(|_| Self::has_javascript(function))
        else {
            return;
        };
        let key = Self::function_key(function);
        let (start, end) = self
            .type_parameters_span(function.type_params)
            .unwrap_or((open, open));
        slots.push(Slot::new(Place::TypeParameters, key, (start, end)));
        let (start, end) = match function.this_param.some() {
            Some(this) => {
                let this = &self.file[this];
                let end = match function.params.iter().next() {
                    Some(next) => self.file[next].pos,
                    None => this
                        .ty
                        .some()
                        .map_or(self.file[this.pat].end, |annotation| {
                            self.type_span(annotation).1
                        }),
                };
                (this.pos, end)
            }
            None => (open + 1, open + 1),
        };
        slots.push(Slot::new(Place::ThisParameter, key, (start, end)));
        let (start, end) = match function.ret.some() {
            Some(annotation) => {
                let (start, end) = self.type_span(annotation);
                let colon = self.before_trivia(start).saturating_sub(1);
                (self.before_trivia(colon), end)
            }
            None => {
                let Some(behind) = (if function.kind == FnKind::Arrow {
                    Some(function.anchor)
                } else {
                    self.body_start(id)
                }) else {
                    return;
                };
                let close = self.before_trivia(behind);
                (close, close)
            }
        };
        if start > 0 && self.byte(start - 1) == b')' {
            slots.push(Slot::new(Place::ReturnType, key, (start, end)));
        }
    }

    fn modifier_end(&self, modifier: &Modifier) -> u32 {
        match modifier.kind {
            ModifierKind::Keyword(_) => self.token_end(modifier.pos),
            ModifierKind::Decorator(expression) => self.outer_span(expression).1,
        }
    }

    fn class_keyword(&self, class: &Class) -> u32 {
        let last = self.file.modifier_list(class.modifiers).last();
        last.map_or(class.start, |last| {
            self.after_trivia(self.modifier_end(last))
        })
    }

    fn class_body_pos(&self, class: &Class) -> u32 {
        let mut at = if class.name.is_some() {
            self.token_end(class.name_pos)
        } else {
            self.token_end(self.class_keyword(class))
        };
        at = self
            .type_parameters_span(class.type_params)
            .map_or(at, |span| span.1);
        if class.extends.is_some() {
            at = self.outer_span(class.extends).1;
            at = self
                .type_arguments_span(class.extends_args)
                .map_or(at, |span| span.1);
        }
        at = self
            .file
            .ids(class.other_extends)
            .next_back()
            .map_or(at, |last| self.outer_span(last).1.max(at));
        for list in [class.implements, class.other_implements] {
            at = self
                .file
                .ids(list)
                .next_back()
                .map_or(at, |last| self.type_span(last).1.max(at));
        }
        at = self.after_trivia(at);
        while (at as usize) < self.text.len() && self.byte(at) != b'{' {
            at = self.after_trivia(self.token_end(at).max(at + 1));
        }
        at
    }

    fn class_slots(&self, class: &Class, slots: &mut Vec<Slot>) {
        let key = self.class_body_pos(class);
        let keyword = self.class_keyword(class);
        let (start, end) = match self.file.find_modifier(class.modifiers, Flags::ABSTRACT) {
            Some(at) => (at, self.after_trivia(self.token_end(at))),
            None => (keyword, keyword),
        };
        slots.push(Slot::new(Place::ClassKeyword, key, (start, end)));
        let mut at = if class.name.is_some() {
            self.token_end(class.name_pos)
        } else {
            self.token_end(keyword)
        };
        let (start, end) = self
            .type_parameters_span(class.type_params)
            .unwrap_or((at, at));
        slots.push(Slot::new(Place::ClassTypeParameters, key, (start, end)));
        at = end;
        if class.extends.is_some() {
            at = self.outer_span(class.extends).1;
            let (start, end) = self
                .type_arguments_span(class.extends_args)
                .unwrap_or((at, at));
            slots.push(Slot::new(Place::ExtendsTypeArguments, key, (start, end)));
            at = end;
        }
        let end = self
            .file
            .ids(class.implements)
            .next_back()
            .map_or(at, |last| self.type_span(last).1);
        slots.push(Slot::new(Place::Implements, key, (at, end)));
    }

    fn is_type_only_member(&self, member: &Member) -> bool {
        member.kind == MemberKind::IndexSignature
            || member.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT)
            || member.func.some().is_some_and(|function| {
                member.kind != MemberKind::StaticBlock
                    && matches!(self.file[function].body, FnBody::None)
            })
    }

    fn member_name_end(&self, member: &Member) -> u32 {
        match member.key {
            PropKey::Computed(expression) => self.after_trivia(self.outer_span(expression).1) + 1,
            _ if self.byte(member.name_pos) == b'[' => {
                let inside = self.after_trivia(member.name_pos + 1);
                self.after_trivia(self.token_end(inside)) + 1
            }
            _ => self.token_end(member.name_pos),
        }
    }

    fn is_in_computed_key(&self, mut name: u32) -> bool {
        while name > 0 {
            let before = self.before_trivia(name) - 1;
            match self.byte(before) {
                b'[' => return true,
                b'.' => {
                    name = self.before_trivia(before);
                    while name > 0
                        && matches!(self.byte(name - 1), b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$' | 0x80..)
                    {
                        name -= 1;
                    }
                }
                _ => return false,
            }
        }
        false
    }

    fn member_key(&self, member: &Member) -> u32 {
        if self.byte(member.name_pos) != b'[' {
            return member.name_pos;
        }
        let mut key = self.after_trivia(member.name_pos + 1);
        while let dot = self.after_trivia(self.token_end(key))
            && self.byte(dot) == b'.'
            && self.byte(dot + 1) != b'.'
        {
            key = self.after_trivia(dot + 1);
        }
        key
    }

    fn member_slots(&self, member: &Member, slots: &mut Vec<Slot>) {
        if member.kind == MemberKind::StaticBlock {
            return;
        }
        let key = self.member_key(member);
        let modifiers = self.file.modifier_list(member.modifiers);
        let is_decorator =
            |modifier: &&Modifier| matches!(modifier.kind, ModifierKind::Decorator(_));
        let first = modifiers
            .iter()
            .take_while(is_decorator)
            .last()
            .map_or(member.start, |last| {
                self.after_trivia(self.modifier_end(last))
            });
        let span_of = |flags: Flags| {
            let mut listed = modifiers.iter().filter(|modifier| {
                flags.contains(modifier.kind.flag()) && !modifier.kind.flag().is_empty()
            });
            let start = listed.next()?;
            let end = listed.next_back().unwrap_or(start);
            Some((start.pos, self.after_trivia(self.token_end(end.pos))))
        };
        let (start, end) =
            span_of(Flags::PUBLIC | Flags::PRIVATE | Flags::PROTECTED).unwrap_or((first, first));
        slots.push(Slot::new(Place::MemberStart, key, (start, end)));
        let behind_static = match self.file.find_modifier(member.modifiers, Flags::STATIC) {
            Some(at) => self.after_trivia(self.token_end(at)),
            None => end,
        };
        let (start, end) =
            span_of(Flags::OVERRIDE | Flags::READONLY).unwrap_or((behind_static, behind_static));
        slots.push(Slot::new(Place::MemberName, key, (start, end)));
        if member.kind == MemberKind::Property {
            let start = self.member_name_end(member);
            let mark = self.after_trivia(start);
            let end = match member.ty.some() {
                Some(annotation) => self.type_span(annotation).1,
                None if member.flags.intersects(Flags::OPTIONAL | Flags::DEFINITE)
                    && matches!(self.byte(mark), b'?' | b'!') =>
                {
                    mark + 1
                }
                None => start,
            };
            slots.push(Slot::new(Place::MemberType, key, (start, end)));
        }
    }

    fn call_slot(&self, expr: &Expr) -> Option<Slot> {
        let (call, key) = match expr.kind {
            ExprKind::Call(call) => (&self.file[call], self.file[call].close_pos),
            ExprKind::New(call) | ExprKind::TaggedTemplate(call) => (&self.file[call], expr.pos),
            _ => return None,
        };
        let mut at = self.outer_span(call.callee).1;
        if call.chain == Chain::Start
            && self.text[self.after_trivia(at) as usize..].starts_with(b"?.")
        {
            at = self.after_trivia(at) + 2;
        }
        let (start, end) = self
            .type_arguments_span(self.file.list_at(call.type_args))
            .unwrap_or((at, at));
        Some(Slot::new(Place::TypeArguments, key, (start, end)))
    }

    fn slots(&self) -> Vec<Slot> {
        let file = self.file;
        let mut slots = Vec::new();
        for declaration in file.var_decls.iter() {
            slots.extend(self.binding_slot(declaration.pat, declaration.ty, false));
        }
        let this_parameters: FxHashSet<u32> = file
            .fns
            .iter()
            .filter_map(|function| function.this_param.some())
            .map(|this| this.0)
            .collect();
        for (index, parameter) in file.params.iter().enumerate() {
            if !this_parameters.contains(&(index as u32)) {
                slots.extend(self.binding_slot(
                    parameter.pat,
                    parameter.ty,
                    parameter.flags.contains(Flags::OPTIONAL),
                ));
            }
        }
        for index in 0..file.fns.len() {
            self.function_slots(FnId(index as u32), &mut slots);
        }
        for class in file.classes.iter() {
            self.class_slots(class, &mut slots);
            for member in class
                .members
                .iter()
                .map(|member| &file[member])
                .filter(|member| !self.is_type_only_member(member))
            {
                self.member_slots(member, &mut slots);
            }
        }
        slots.extend(file.exprs.iter().filter_map(|expr| self.call_slot(expr)));
        slots
    }

    fn is_type_only_statement(&self, id: StmtId) -> bool {
        let (file, statement) = (self.file, &self.file[id]);
        let is_ambient = file
            .modifiers_to_flags(file.stmt_modifiers(id))
            .contains(Flags::AMBIENT);
        match statement.kind {
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::ExportAsNamespace(_) => {
                true
            }
            StmtKind::Import(import) => file[import].type_only,
            StmtKind::ExportNamed(export) => file[export].type_only,
            StmtKind::ExportStar { type_only, .. } => type_only,
            StmtKind::Fn(function) => is_ambient || matches!(file[function].body, FnBody::None),
            StmtKind::Var(_) | StmtKind::Class(_) | StmtKind::Enum(_) => is_ambient,
            StmtKind::Module(module) => {
                is_ambient
                    || !matches!(file[module].name, ModuleName::Ident(_))
                    || file
                        .ids(file[module].body)
                        .all(|inner| self.is_type_only_statement(inner))
            }
            StmtKind::ImportEquals(import) => file[import].flags.contains(Flags::TYPE_ONLY),
            _ => false,
        }
    }

    fn type_only_declarations(&self) -> Vec<(u32, u32)> {
        let file = self.file;
        let statements = (0..file.stmts.len())
            .filter(|&index| self.is_type_only_statement(StmtId(index as u32)))
            .map(|index| (file.stmts[index].start, file.stmts[index].loc.end));
        let members = file
            .classes
            .iter()
            .flat_map(|class| class.members.iter())
            .map(|member: MemberId| &file[member])
            .filter(|member| self.is_type_only_member(member));
        statements
            .chain(members.map(|member| (member.start, member.loc.end)))
            .collect()
    }

    fn cast_type_spans(&self) -> Vec<(u32, u32)> {
        let types = self.file.exprs.iter().filter_map(|expr| match expr.kind {
            ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => Some(self.type_span(ty)),
            ExprKind::Instantiation { type_args, .. } => {
                self.type_arguments_span(self.file.list_at(type_args))
            }
            _ => None,
        });
        types.collect()
    }

    fn type_ranges(&self) -> Vec<(u32, u32)> {
        let mut ranges = self.type_only_declarations();
        ranges.extend(
            self.slots()
                .iter()
                .filter(|slot| slot.end > slot.start)
                .map(|slot| (slot.start, slot.end)),
        );
        ranges.extend(self.cast_type_spans());
        merged(ranges)
    }

    fn statement_lists(&self) -> Vec<IdList<StmtId>> {
        let file = self.file;
        let mut lists = vec![file.body];
        lists.extend(
            file.stmts
                .iter()
                .filter_map(|statement| match statement.kind {
                    StmtKind::Block(list) => Some(list),
                    _ => None,
                }),
        );
        lists.extend(file.fns.iter().filter_map(|function| match function.body {
            FnBody::Block(list) => Some(list),
            _ => None,
        }));
        lists.extend(file.cases.iter().map(|case| case.body));
        lists.extend(
            (0..file.stmts.len())
                .map(|index| StmtId(index as u32))
                .filter_map(|id| match file[id].kind {
                    StmtKind::Module(module) if !self.is_type_only_statement(id) => {
                        Some(file[module].body)
                    }
                    _ => None,
                }),
        );
        lists
    }

    fn missing_line_breaks(&self) -> Vec<u32> {
        let file = self.file;
        let statements = self.statement_lists().into_iter().map(|list| {
            let spans = file.ids(list).map(|id| (file[id].start, file[id].loc.end));
            spans.collect::<Vec<(u32, u32)>>()
        });
        let members = file.classes.iter().map(|class| {
            let spans = class.members.iter().map(|member| &file[member]);
            spans.map(|member| (member.start, member.loc.end)).collect()
        });
        let mut starts: Vec<u32> = statements
            .chain(members)
            .flat_map(|spans| {
                let pairs = spans.iter().zip(spans.iter().skip(1));
                let on_one_line = pairs.filter(|(before, after)| {
                    let between = self.text.get(before.1 as usize..after.0 as usize);
                    between.is_some_and(|between| !bun_core::strings::contains_char(between, b'\n'))
                });
                on_one_line.map(|(_, after)| after.0).collect::<Vec<u32>>()
            })
            .collect();
        starts.sort_unstable();
        starts.dedup();
        starts
    }

    fn after_modifiers(&self, id: StmtId) -> u32 {
        let statement = &self.file[id];
        let last = self.file.modifier_list(self.file.stmt_modifiers(id)).last();
        last.map_or(statement.start, |last| {
            self.after_trivia(self.modifier_end(last))
        })
    }

    fn with_trailing_whitespace(&self, start: u32, end: u32) -> (u32, u32) {
        let blanks = self.text[end as usize..]
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t' | b'\n' | b'\r'))
            .count();
        (start, end + blanks as u32)
    }

    fn children(&self, expr: ExprId) -> Vec<ExprId> {
        let file = self.file;
        match file[expr].kind {
            ExprKind::Dot { obj, .. } => vec![obj],
            ExprKind::Index { obj, index, .. } => vec![obj, index],
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                std::iter::once(file[call].callee)
                    .chain(file.ids(file[call].args))
                    .collect()
            }
            ExprKind::Unary { operand, .. }
            | ExprKind::Await(operand)
            | ExprKind::Spread(operand) => vec![operand],
            ExprKind::Yield { value, .. } => vec![value],
            ExprKind::Binary { left, right, .. } => vec![left, right],
            ExprKind::Assign { target, value, .. } => vec![target, value],
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = file.branches(branches);
                vec![test, yes, no]
            }
            ExprKind::Template { exprs }
            | ExprKind::Array(exprs)
            | ExprKind::ImportCall { args: exprs } => file.ids(exprs).collect(),
            ExprKind::Object(properties) => properties
                .iter()
                .map(|property| file[property].value)
                .collect(),
            ExprKind::Fn(function) => match file[function].body {
                FnBody::Expr(body) => vec![body],
                _ => Vec::new(),
            },
            _ => file.type_assertion_operand(expr).into_iter().collect(),
        }
    }

    fn parent_links(&self) -> Vec<Option<(ExprId, usize)>> {
        let mut places = vec![None; self.file.exprs.len()];
        for index in 0..self.file.exprs.len() {
            let parent = ExprId(index as u32);
            for (place, child) in self.children(parent).into_iter().enumerate() {
                if let Some(known) = places.get_mut(child.idx()) {
                    *known = Some((parent, place));
                }
            }
        }
        places
    }

    fn cast_chains(&self) -> Vec<CastChain> {
        let count = self.file.exprs.len();
        let mut is_operand = vec![false; count];
        for index in 0..count {
            if let Some(operand) = self.file.type_assertion_operand(ExprId(index as u32)) {
                is_operand[operand.idx()] = true;
            }
        }
        let mut chains = Vec::new();
        for index in (0..count).filter(|&index| !is_operand[index]) {
            let outermost = ExprId(index as u32);
            let (mut casts, mut operand) = (Vec::new(), outermost);
            while let Some(inner) = self.file.type_assertion_operand(operand) {
                casts.push(operand);
                operand = inner;
            }
            if !casts.is_empty() {
                casts.reverse();
                chains.push(CastChain {
                    operand,
                    outermost,
                    casts,
                });
            }
        }
        chains
    }

    fn level(&self, expr: ExprId) -> Level {
        match self.file[expr].kind {
            ExprKind::Binary { op, .. } => level_of_operator(op),
            ExprKind::Assign { .. } => Level::Assign,
            ExprKind::Cond { .. } => Level::Conditional,
            ExprKind::Yield { .. } => Level::Yield,
            ExprKind::Spread(_) => Level::Comma,
            ExprKind::Fn(function) if self.file[function].kind == FnKind::Arrow => Level::Assign,
            ExprKind::Unary {
                op: UnOp::PostInc | UnOp::PostDec,
                ..
            } => Level::Postfix,
            ExprKind::Unary { .. } | ExprKind::Await(_) => Level::Prefix,
            ExprKind::New(call) if self.file[call].close_pos == u32::MAX => Level::New,
            ExprKind::Call(_) | ExprKind::ImportCall { .. } => Level::Call,
            ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) => {
                Level::Compare
            }
            ExprKind::Instantiation { .. } => Level::Postfix,
            _ => Level::Member,
        }
    }

    fn level_required_by_cast(&self, cast: ExprId) -> Level {
        match self.file[cast].kind {
            ExprKind::NonNull(_) | ExprKind::Instantiation { .. } => Level::Call,
            _ => Level::Compare,
        }
    }

    fn context(&self) -> Context {
        let file = self.file;
        let count = file.exprs.len();
        let mut context = Context {
            required: vec![Level::Yield; count],
            parent: vec![ExprId::NONE; count],
            is_before_operator: vec![false; count],
        };
        for (index, expr) in file.exprs.iter().enumerate() {
            let parent = ExprId(index as u32);
            let mut set = |child: ExprId, level: Level| {
                if let Some(required) = context.required.get_mut(child.idx()) {
                    *required = level;
                    context.parent[child.idx()] = parent;
                }
            };
            match expr.kind {
                ExprKind::Dot { obj, .. } => set(obj, Level::Call),
                ExprKind::Index { obj, index, .. } => {
                    set(obj, Level::Call);
                    set(index, Level::Lowest);
                }
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => {
                    set(file[call].callee, Level::Call)
                }
                ExprKind::New(call) => set(file[call].callee, Level::Member),
                ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => set(operand, Level::Postfix),
                ExprKind::Unary { operand, .. } | ExprKind::Await(operand) => {
                    set(operand, Level::Prefix)
                }
                ExprKind::Binary {
                    op: BinOp::Pow,
                    left,
                    right,
                } => {
                    set(left, Level::Postfix);
                    set(right, Level::Exponentiation);
                }
                ExprKind::Binary { op, left, right } => {
                    set(left, level_of_operator(op));
                    set(right, level_of_operator(op).add_f(1));
                }
                ExprKind::Assign { target, value, .. } => {
                    set(target, Level::Postfix);
                    set(value, Level::Yield);
                }
                ExprKind::Cond { test, branches } => {
                    let Branches { yes, no } = file.branches(branches);
                    set(test, Level::NullishCoalescing);
                    set(yes, Level::Yield);
                    set(no, Level::Yield);
                }
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::AsConst(expr) => set(expr, Level::Compare),
                ExprKind::NonNull(expr) | ExprKind::Instantiation { expr, .. } => {
                    set(expr, Level::Call)
                }
                ExprKind::Template { exprs } => {
                    file.ids(exprs).for_each(|inner| set(inner, Level::Lowest))
                }
                _ => {}
            }
            if let ExprKind::Binary { left: first, .. } | ExprKind::Cond { test: first, .. } =
                expr.kind
                && let Some(is_before) = context.is_before_operator.get_mut(first.idx())
            {
                *is_before = true;
            }
        }
        let mut lowest = |expr: ExprId| {
            if let Some(required) = context.required.get_mut(expr.idx()) {
                *required = Level::Lowest;
            }
        };
        for statement in file.stmts.iter() {
            match statement.kind {
                StmtKind::Expr(expr) | StmtKind::Return(expr) | StmtKind::Throw(expr) => {
                    lowest(expr)
                }
                StmtKind::If { test, .. }
                | StmtKind::While { test, .. }
                | StmtKind::DoWhile { test, .. } => lowest(test),
                StmtKind::For { test, update, .. } => {
                    lowest(test);
                    lowest(update);
                }
                StmtKind::ForIn { expr, .. } | StmtKind::Switch { expr, .. } => lowest(expr),
                _ => {}
            }
        }
        for case in file.cases.iter() {
            lowest(case.test);
        }
        for class in file.classes.iter() {
            if let Some(required) = context.required.get_mut(class.extends.idx()) {
                *required = Level::Call;
            }
        }
        context
    }

    fn starts_a_statement(&self, mut at: u32, is_object: bool) -> bool {
        loop {
            let before = self.before_trivia(at);
            if before == 0 {
                return true;
            }
            match self.byte(before - 1) {
                b'(' => at = before - 1,
                b';' | b'{' | b'}' => return true,
                b'>' => return is_object && before >= 2 && self.byte(before - 2) == b'=',
                _ => return self.text[..before as usize].ends_with(b"export default"),
            }
        }
    }

    fn next_token_extends_type(&self, end: u32) -> bool {
        let next = self.after_trivia(end);
        match (self.byte(next), self.byte(next + 1)) {
            (b'|', b'|' | b'=')
            | (b'&', b'&' | b'=')
            | (b'?', b'?' | b'.')
            | (b'<', b'<' | b'=') => false,
            (b'|' | b'&' | b'?' | b'<' | b'[' | b'.', _) => true,
            _ => false,
        }
    }

    fn needs_parentheses(&self, context: &Context, operand: ExprId, slot: ExprId) -> bool {
        if self.level(operand).lt(context.required[slot.idx()]) {
            return true;
        }
        let kind = self.file[operand].kind;
        let is_logical = |kind: ExprKind| {
            matches!(
                kind,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or,
                    ..
                }
            )
        };
        let is_nullish = |kind: ExprKind| {
            matches!(
                kind,
                ExprKind::Binary {
                    op: BinOp::Nullish,
                    ..
                }
            )
        };
        if let Some(parent) = context.parent[slot.idx()]
            .some()
            .map(|parent| self.file[parent].kind)
            && (is_logical(kind) && is_nullish(parent) || is_nullish(kind) && is_logical(parent))
        {
            return true;
        }
        let chain_of = |kind: ExprKind| match kind {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain,
            ExprKind::Call(call) => self.file[call].chain,
            _ => Chain::No,
        };
        let parent = context.parent[slot.idx()]
            .some()
            .map(|parent| self.file[parent].kind);
        if chain_of(kind) != Chain::No
            && context.required[slot.idx()].gte(Level::Call)
            && parent.is_some_and(|parent| chain_of(parent) == Chain::No)
        {
            return true;
        }
        let is_ambiguous_at_statement_start = match kind {
            ExprKind::Object(_) | ExprKind::Class(_) => true,
            ExprKind::Fn(function) => self.file[function].kind != FnKind::Arrow,
            _ => false,
        };
        is_ambiguous_at_statement_start
            && self.starts_a_statement(self.file[operand].pos, matches!(kind, ExprKind::Object(_)))
    }

    fn shape(&self, expr: ExprId) -> (Shape, u32) {
        let node = &self.file[expr];
        match node.kind {
            ExprKind::Dot { .. } => (Shape::Dot, self.file.name_pos(expr)),
            ExprKind::Index { index, .. } => (
                Shape::Index,
                self.file
                    .exprs
                    .get(index.idx())
                    .map_or(node.pos, |index| index.pos),
            ),
            ExprKind::Call(call) => (Shape::Call, self.file[call].close_pos),
            ExprKind::New(_) => (Shape::New, node.pos),
            ExprKind::Unary {
                op: UnOp::PostInc | UnOp::PostDec,
                ..
            } => (Shape::Postfix, node.pos),
            ExprKind::Unary { .. } | ExprKind::Await(_) | ExprKind::Yield { .. } => {
                (Shape::Prefix, node.pos)
            }
            ExprKind::Binary { right, .. } | ExprKind::Assign { value: right, .. } => (
                Shape::Binary,
                self.file
                    .exprs
                    .get(right.idx())
                    .map_or(node.pos, |right| right.pos),
            ),
            ExprKind::Cond { branches, .. } => (
                Shape::Conditional,
                self.file
                    .exprs
                    .get(self.file.branches(branches).no.idx())
                    .map_or(node.pos, |no| no.pos),
            ),
            _ => (Shape::Leaf, node.pos),
        }
    }

    fn name_of_dotted_index(&self, expr: ExprId) -> Option<u32> {
        let ExprKind::Index { index, .. } = self.file[expr].kind else {
            return None;
        };
        match self.file.exprs.get(index.idx())?.kind {
            ExprKind::Dot { .. } => Some(self.file.name_pos(index)),
            _ => None,
        }
    }

    fn is_javascript_without(&self, erased: &[(u32, u32)]) -> bool {
        let file = self.file;
        let statements = file
            .stmts
            .iter()
            .filter(|statement| {
                matches!(
                    statement.kind,
                    StmtKind::Enum(_)
                        | StmtKind::Module(_)
                        | StmtKind::ImportEquals(_)
                        | StmtKind::ExportAssign(_)
                )
            })
            .map(|statement| statement.start);
        let parameters = file
            .params
            .iter()
            .filter(|parameter| parameter.flags.contains(Flags::PARAMETER_PROPERTY))
            .map(|parameter| parameter.pos);
        let imports = file.import_specs.iter().map(|it| (it.type_only, it.start));
        let exports = file.export_specs.iter().map(|it| (it.type_only, it.start));
        let names = imports.chain(exports).filter(|it| it.0).map(|it| it.1);
        statements
            .chain(parameters)
            .chain(names)
            .all(|at| is_inside(erased, at))
    }

    fn erasable_ranges(&self) -> Option<Vec<(u32, u32)>> {
        let file = self.file;
        let mut ranges: Vec<(u32, u32)> = self
            .slots()
            .iter()
            .filter(|slot| slot.end > slot.start)
            .map(|slot| (slot.start, slot.end))
            .collect();
        let declarations = self.type_only_declarations().into_iter();
        ranges.extend(declarations.map(|(start, end)| self.with_trailing_whitespace(start, end)));
        for directive in file.comment_directives.iter() {
            ranges.push(self.with_trailing_whitespace(directive.start, directive.end));
        }
        let context = self.context();
        for chain in self.cast_chains() {
            let mut inner = chain.operand;
            for &cast in &chain.casts {
                let start = self.outer_span(inner).1;
                if self.byte(file[cast].pos) == b'<' && file[cast].pos < self.outer_span(inner).0 {
                    return None;
                }
                ranges.push((start, file[cast].end));
                for &(_, open, close) in self.parentheses(cast) {
                    ranges.push((open, open + 1));
                    ranges.push((close - 1, close));
                }
                inner = cast;
            }
            match self.parentheses(chain.operand) {
                [] => {}
                [(_, open, close)] => {
                    if !self.needs_parentheses(&context, chain.operand, chain.outermost) {
                        ranges.push((*open, open + 1));
                        ranges.push((close - 1, *close));
                    }
                }
                _ => return None,
            }
        }
        for property in file.props.iter().filter(|property| {
            property.kind == PropKind::Init
                && property.name_kind == NameKind::Identifier
                && matches!(property.key, PropKey::Name(_))
        }) {
            let mut operand = property.value;
            while let Some(inner) = file
                .type_assertion_operand(operand)
                .filter(|_| self.parentheses(operand).is_empty())
            {
                operand = inner;
            }
            let Some(node) = file
                .exprs
                .get(operand.idx())
                .filter(|_| operand != property.value && self.parentheses(operand).is_empty())
            else {
                continue;
            };
            if matches!(node.kind, ExprKind::Ident(_))
                && self.word(node.pos) == self.word(property.pos)
            {
                ranges.push((property.pos, node.pos));
            }
        }
        ranges.sort_by_key(|range| (range.0, std::cmp::Reverse(range.1)));
        let mut outermost: Vec<(u32, u32)> = Vec::new();
        for range in ranges {
            match outermost.last() {
                Some(last) if range.1 <= last.1 => {}
                Some(last) if range.0 < last.1 => return None,
                _ => outermost.push(range),
            }
        }
        Some(outermost)
    }
}

fn erase_types(path: &[u8], typescript: &[u8]) -> Option<Vec<u8>> {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let file = parse(&session, &atoms, path, typescript).ok()?;
    let syntax = Syntax {
        file: &file,
        text: typescript,
    };
    let ranges = syntax.erasable_ranges()?;
    if !syntax.is_javascript_without(&ranges) {
        return None;
    }
    let mut javascript = Vec::with_capacity(typescript.len());
    let mut at = 0;
    for (start, end) in ranges {
        javascript.extend_from_slice(&typescript[at..start as usize]);
        at = end as usize;
    }
    javascript.extend_from_slice(&typescript[at..]);
    Some(javascript)
}

struct Mappings {
    entries: Vec<(u32, u32, u32)>,
}

fn offset_in_line(text: &[u8], from: usize, columns: usize) -> usize {
    let (mut at, mut left) = (from, columns);
    while left > 0 && at < text.len() {
        let (bytes, units) = match text[at] {
            0..=0x7F => (1, 1),
            0x80..=0xDF => (2, 1),
            0xE0..=0xEF => (3, 1),
            _ => (4, 2),
        };
        at += bytes;
        left = left.saturating_sub(units);
    }
    at.min(text.len())
}

impl Mappings {
    fn decode(
        mappings: &[u8],
        javascript: &[u8],
        sources: &[Source<'_>],
    ) -> Result<Mappings, String> {
        let generated_lines = compute_ecma_line_starts(javascript);
        let source_lines: Vec<Vec<u32>> = sources
            .iter()
            .map(|source| compute_ecma_line_starts(source.text))
            .collect();
        let mut entries = Vec::new();
        let (mut source, mut line, mut column) = (0i64, 0i64, 0i64);
        for (generated_line, segments) in bun_core::strings::split(mappings, b";").enumerate() {
            let Some(&line_offset) = generated_lines.get(generated_line) else {
                break;
            };
            let (mut generated_column, mut generated_offset, mut walked) =
                (0i64, line_offset as usize, 0i64);
            for segment in
                bun_core::strings::split(segments, b",").filter(|segment| !segment.is_empty())
            {
                let mut fields = [0i64; 5];
                let (mut count, mut value, mut shift) = (0, 0i64, 0);
                for &byte in segment {
                    let digit = match byte {
                        b'A'..=b'Z' => byte - b'A',
                        b'a'..=b'z' => byte - b'a' + 26,
                        b'0'..=b'9' => byte - b'0' + 52,
                        b'+' => 62,
                        b'/' => 63,
                        _ => return Err("the source map has a character that is not base64".into()),
                    } as i64;
                    value |= (digit & 31) << shift;
                    shift += 5;
                    if digit & 32 == 0 {
                        if count < 5 {
                            fields[count] = if value & 1 == 1 {
                                -(value >> 1)
                            } else {
                                value >> 1
                            };
                        }
                        (count, value, shift) = (count + 1, 0, 0);
                    }
                }
                generated_column += fields[0];
                if count < 4 {
                    continue;
                }
                source += fields[1];
                line += fields[2];
                column += fields[3];
                generated_offset = offset_in_line(
                    javascript,
                    generated_offset,
                    (generated_column - walked).max(0) as usize,
                );
                walked = generated_column;
                let Some(lines) = source_lines.get(source as usize) else {
                    continue;
                };
                let Some(&start) = lines.get(line as usize) else {
                    continue;
                };
                let original = offset_in_line(
                    sources[source as usize].text,
                    start as usize,
                    column.max(0) as usize,
                );
                entries.push((generated_offset as u32, source as u32, original as u32));
            }
        }
        entries.sort_by_key(|entry| entry.0);
        Ok(Mappings { entries })
    }

    fn original(&self, generated: u32) -> Option<(u32, u32)> {
        let until = self.entries.partition_point(|entry| entry.0 <= generated);
        let last = self.entries[..until]
            .last()
            .filter(|entry| entry.0 == generated)?;
        Some((last.1, last.2))
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Order {
    Line,
    Signature,
    Directive,
    MemberStart,
    MemberName,
    Open(u32),
    Close(u32),
    Slot,
}

struct Insertions {
    list: Vec<(u32, Order, usize, Vec<u8>)>,
}

impl Insertions {
    fn add(&mut self, at: u32, order: Order, text: Vec<u8>) {
        if !text.is_empty() {
            self.list.push((at, order, self.list.len(), text));
        }
    }

    fn add_line_before(&mut self, javascript: &[u8], at: u32, text: &[u8]) {
        self.add_line_in_order(javascript, at, Order::Line, text);
    }

    fn add_line_in_order(&mut self, javascript: &[u8], at: u32, order: Order, text: &[u8]) {
        let indent = &javascript[line_start(javascript, at as usize)..at as usize];
        self.add(
            at,
            order,
            [text, b"\n", if is_blank(indent) { indent } else { b"" }].concat(),
        );
    }

    fn ignore_after_line_breaks(&mut self, start: u32, end: u32) {
        for (_, _, _, text) in self
            .list
            .iter_mut()
            .filter(|inserted| start < inserted.0 && inserted.0 <= end)
        {
            if let Some(last) = bun_core::strings::last_index_of_char(&text[..], b'\n') {
                text.splice(last..last, b"\n// @ts-ignore".iter().copied());
            }
        }
    }

    fn apply(mut self, javascript: &[u8]) -> Vec<u8> {
        self.list.sort_by_key(|a| (a.0, a.1, a.2));
        let mut text = Vec::with_capacity(javascript.len() * 2);
        let append = |text: &mut Vec<u8>, bytes: &[u8]| {
            let is_word_byte =
                |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | 0x80..);
            if let (Some(last), Some(first)) = (text.last(), bytes.first())
                && (is_word_byte(last) && is_word_byte(first) || (*last, *first) == (b'!', b'='))
            {
                text.push(b' ');
            }
            text.extend_from_slice(bytes);
        };
        let mut at = 0;
        for (offset, _, _, inserted) in &self.list {
            append(&mut text, &javascript[at..*offset as usize]);
            append(&mut text, inserted);
            at = *offset as usize;
        }
        append(&mut text, &javascript[at..]);
        text
    }
}

fn outermost_only(mut slots: Vec<Slot>, regions: &[(u32, u32)]) -> Vec<Slot> {
    slots.retain(|slot| slot.end > slot.start);
    slots.sort_by_key(|slot| (slot.start, std::cmp::Reverse(slot.end)));
    let mut retained: Vec<Slot> = Vec::new();
    let mut covered = 0;
    for slot in slots {
        let is_in_region = regions
            .iter()
            .any(|region| region.0 <= slot.start && slot.end <= region.1);
        if slot.start >= covered && !is_in_region {
            covered = slot.end;
            retained.push(slot);
        }
    }
    retained
}

struct TypedText {
    text: Vec<u8>,
    dropped_casts: usize,
    has_default_export: bool,
    modules_of_untyped_values: Vec<Vec<u8>>,
    source: Option<Vec<u8>>,
}

struct Bundle<'a> {
    modules: &'a [ModuleTypes],
    emitted_declarations: &'a [ModuleTypes],
    entry_point: Option<&'a [u8]>,
}

struct Written<'a, 's> {
    syntax: Syntax<'a, 's>,
    types: Option<&'a ModuleTypes>,
    type_ranges: Vec<(u32, u32)>,
    declarations: Vec<(u32, u32)>,
    edits: Vec<(u32, u32, Vec<u8>)>,
}

impl Written<'_, '_> {
    fn is_unchecked(&self) -> bool {
        self.syntax.file.check_directive == Some(false)
    }

    fn text(&self, start: u32, end: u32) -> Vec<u8> {
        let (mut text, mut at) = (Vec::new(), start);
        let from = self.edits.partition_point(|edit| edit.0 < start);
        for (edit_start, edit_end, replacement) in
            self.edits[from..].iter().take_while(|edit| edit.1 <= end)
        {
            text.extend_from_slice(&self.syntax.text[at as usize..*edit_start as usize]);
            text.extend_from_slice(replacement);
            at = *edit_end;
        }
        text.extend_from_slice(&self.syntax.text[at as usize..end as usize]);
        text
    }

    fn trimmed_text(&self, start: u32, end: u32) -> Vec<u8> {
        self.text(start, end).trim_ascii().to_vec()
    }

    fn types_of_namespace(&self, id: StmtId, dropped_modifiers: Flags) -> Option<Vec<u8>> {
        let (syntax, file) = (&self.syntax, self.syntax.file);
        let StmtKind::Module(declared) = file[id].kind else {
            return None;
        };
        let inside: Vec<Vec<u8>> = (file.ids(file[declared].body))
            .filter_map(|inner| {
                if syntax.is_type_only_statement(inner) {
                    Some(self.statement_text(inner, Flags::empty()))
                } else {
                    self.types_of_namespace(inner, Flags::empty())
                }
            })
            .collect();
        if inside.is_empty() {
            return None;
        }
        let is_exported = file
            .modifiers_to_flags(file.stmt_modifiers(id))
            .contains(Flags::EXPORT)
            && !dropped_modifiers.contains(Flags::EXPORT);
        let name = self.trimmed_text(
            file[declared].name_pos,
            syntax.token_end(file[declared].name_pos),
        );
        Some(
            [
                if is_exported {
                    &b"export namespace "[..]
                } else {
                    b"namespace "
                },
                &name,
                b" {\n",
                &inside.join(&b"\n"[..]),
                b"\n}",
            ]
            .concat(),
        )
    }

    fn merged_augmentation_text(&self, statement: &Stmt) -> Option<Vec<u8>> {
        let file = self.syntax.file;
        let StmtKind::Module(declared) = statement.kind else {
            return None;
        };
        self.types?
            .augmented_modules
            .iter()
            .find(|augmented| augmented.0 == statement.start)?;
        let inside = file.ids(file[declared].body).map(|inner| {
            let declare: &[u8] = if matches!(
                file[inner].kind,
                StmtKind::Interface(_) | StmtKind::TypeAlias(_)
            ) {
                b""
            } else {
                b"declare "
            };
            [
                declare,
                &self.statement_text(inner, Flags::EXPORT | Flags::DEFAULT | Flags::AMBIENT)[..],
            ]
            .concat()
        });
        Some(inside.collect::<Vec<_>>().join(&b"\n"[..]))
    }

    fn statement_text(&self, id: StmtId, dropped_modifiers: Flags) -> Vec<u8> {
        let statement = &self.syntax.file[id];
        let (mut text, mut at) = (Vec::new(), statement.start);
        for modifier in self
            .syntax
            .file
            .modifier_list(self.syntax.file.stmt_modifiers(id))
        {
            let flag = modifier.kind.flag();
            if !flag.is_empty() && dropped_modifiers.contains(flag) {
                text.extend_from_slice(&self.text(at, modifier.pos));
                at = self
                    .syntax
                    .after_trivia(self.syntax.token_end(modifier.pos));
            }
        }
        text.extend_from_slice(&self.text(at, statement.loc.end));
        text
    }
}

#[derive(Copy, Clone)]
enum ImportedAs {
    Default,
    Namespace,
    Named(ImportSpecId),
}

enum Piece {
    Text(Vec<u8>),
    Source(u32, u32),
}

#[derive(Default)]
struct Declared {
    bindings: Vec<u32>,
    names: Vec<u32>,
    statements: Vec<StmtId>,
    enum_statement: Option<StmtId>,
    type_parameters: usize,
    import: Option<(StmtId, ImportedAs)>,
    is_ambient_value: bool,
    is_function: bool,
    is_default_expression: bool,
}

impl<'a, 's> Syntax<'a, 's> {
    fn word(&self, at: u32) -> &'a [u8] {
        &self.text[at as usize..self.token_end(at) as usize]
    }

    fn has_default_export(&self) -> bool {
        self.file
            .export_specs
            .iter()
            .any(|specifier| self.word(specifier.pos) == b"default")
            || self
                .file
                .stmts
                .iter()
                .any(|statement| matches!(statement.kind, StmtKind::ExportDefault(_)))
            || self
                .file
                .modifiers_of_stmts
                .iter()
                .any(|of| self.file.modifiers_to_flags(of.1).contains(Flags::DEFAULT))
    }

    fn identifiers(&self, pattern: PatId, found: &mut Vec<u32>) {
        let Some(node) = self.file.pats.get(pattern.idx()) else {
            return;
        };
        match node.kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => found.push(node.pos),
            PatKind::Object(properties) => properties
                .iter()
                .for_each(|property| self.identifiers(self.file[property].value, found)),
            PatKind::Array(elements) => elements
                .iter()
                .for_each(|element| self.identifiers(self.file[element].pat, found)),
        }
    }

    fn namespace_objects(&self) -> Vec<NamespaceObject<'a>> {
        let file = self.file;
        let variables: FxHashMap<&[u8], &'a VarDecl> = (file.var_decls.iter())
            .filter(|declaration| matches!(file[declaration.pat].kind, PatKind::Ident(_)) && file.exprs.get(declaration.init.idx()).is_some_and(|init| matches!(init.kind, ExprKind::Object(properties) if properties.is_empty())))
            .map(|declaration| (self.word(file[declaration.pat].pos), declaration))
            .collect();
        let mut found = Vec::new();
        for expr in file.exprs.iter() {
            let ExprKind::Call(call) = expr.kind else {
                continue;
            };
            let arguments: Vec<&Expr> = file
                .ids(file[call].args)
                .map(|argument| &file[argument])
                .collect();
            let (callee, [object, getters]) = (&file[file[call].callee], &arguments[..]) else {
                continue;
            };
            let (ExprKind::Ident(_), ExprKind::Ident(_), ExprKind::Object(getters)) =
                (callee.kind, object.kind, getters.kind)
            else {
                continue;
            };
            let Some(&variable) = variables
                .get(self.word(object.pos))
                .filter(|_| self.word(callee.pos) == b"__export")
            else {
                continue;
            };
            let members = getters.iter().map(|getter| &file[getter]).map(|getter| {
                let ExprKind::Fn(function) = file.exprs.get(getter.value.idx())?.kind else {
                    return None;
                };
                let FnBody::Expr(body) = file[function].body else {
                    return None;
                };
                matches!(file[body].kind, ExprKind::Ident(_))
                    .then(|| (self.word(getter.pos), self.word(file[body].pos)))
            });
            if let Some(members) = members.collect::<Option<Vec<_>>>() {
                found.push(NamespaceObject {
                    name: self.word(object.pos),
                    variable,
                    members,
                });
            }
        }
        found
    }

    fn ambient_variable(
        &self,
        binding: u32,
        local: &[u8],
        types: Option<&ModuleTypes>,
    ) -> Option<Vec<Piece>> {
        let file = self.file;
        let declaration = file.var_decls.iter().find(|declaration| {
            file[declaration.pat].pos == binding
                && matches!(file[declaration.pat].kind, PatKind::Ident(_))
        })?;
        let keyword: &[u8] = match declaration.kind {
            VarKind::Var => b"var ",
            VarKind::Let => b"let ",
            VarKind::Const => b"const ",
            VarKind::Using | VarKind::AwaitUsing => return None,
        };
        let head = Piece::Text([&b"declare "[..], keyword, local, b": "].concat());
        let annotation = match declaration.ty.some() {
            Some(annotation) => {
                let (start, end) = self.type_span(annotation);
                vec![Piece::Source(start, end)]
            }
            None => vec![Piece::Text(types?.constant_type(binding)?.to_vec())],
        };
        Some(
            std::iter::once(head)
                .chain(annotation)
                .chain([Piece::Text(b";\n".to_vec())])
                .collect(),
        )
    }

    fn ambient_function(&self, binding: u32, local: &[u8]) -> Option<Vec<Piece>> {
        let file = self.file;
        let function = file.fns.iter().find(|function| {
            function.kind == FnKind::Decl
                && function.name_pos == binding
                && !matches!(function.body, FnBody::None)
        })?;
        let is_declared = |parameter: ParamId| {
            let parameter = &file[parameter];
            parameter.ty.is_some()
                && parameter.default.is_none()
                && matches!(file[parameter.pat].kind, PatKind::Ident(_))
        };
        let end = self.type_span(function.ret.some()?).1;
        function.params.iter().all(is_declared).then(|| {
            vec![
                Piece::Text([&b"declare function "[..], local].concat()),
                Piece::Source(self.token_end(binding), end),
                Piece::Text(b";\n".to_vec()),
            ]
        })
    }

    fn overload_signatures(&self, found: &Declared) -> Vec<StmtId> {
        let file = self.file;
        let is_signature = |id: &StmtId| {
            matches!(file[*id].kind, StmtKind::Fn(function) if matches!(file[function].body, FnBody::None))
                && !file
                    .modifiers_to_flags(file.stmt_modifiers(*id))
                    .contains(Flags::AMBIENT)
        };
        found
            .statements
            .iter()
            .copied()
            .filter(is_signature)
            .collect()
    }

    fn anchored_expressions(&self) -> impl Iterator<Item = (u32, ExprId)> + '_ {
        let file = self.file;
        let initializers = file
            .var_decls
            .iter()
            .filter(|declaration| declaration.init.is_some())
            .filter_map(|declaration| {
                Some((self.first_identifier(declaration.pat)?, declaration.init))
            });
        let statements = file
            .stmts
            .iter()
            .filter_map(|statement| match statement.kind {
                StmtKind::Return(value) | StmtKind::Throw(value) | StmtKind::Expr(value)
                    if value.is_some() =>
                {
                    Some((statement.start, value))
                }
                _ => None,
            });
        initializers.chain(statements)
    }

    fn value_names(&self) -> impl Iterator<Item = u32> + '_ {
        let file = self.file;
        let variables = file
            .pats
            .iter()
            .filter(|pattern| matches!(pattern.kind, PatKind::Ident(_)))
            .map(|pattern| pattern.pos);
        let functions = file
            .fns
            .iter()
            .filter(|function| {
                function.name.is_some() && matches!(function.kind, FnKind::Decl | FnKind::Expr)
            })
            .map(|function| function.name_pos);
        let classes = file
            .classes
            .iter()
            .filter(|class| class.name.is_some())
            .map(|class| class.name_pos);
        variables.chain(functions).chain(classes)
    }

    fn used_names(&self) -> impl Iterator<Item = u32> + '_ {
        let expressions = self.file.exprs.iter();
        expressions
            .filter(|expr| matches!(expr.kind, ExprKind::Ident(_)))
            .map(|expr| expr.pos)
    }

    fn imported_names(&self) -> impl Iterator<Item = u32> + '_ {
        let file = self.file;
        let named = file.import_specs.iter().map(|specifier| specifier.pos);
        let defaults = file
            .imports
            .iter()
            .filter(|import| import.default.is_some())
            .map(|import| import.default_pos);
        let namespaces = file
            .imports
            .iter()
            .filter(|import| import.namespace.is_some())
            .map(|import| import.namespace_pos);
        named.chain(defaults).chain(namespaces)
    }

    fn exported_names(&self) -> FxHashSet<&'a [u8]> {
        let specifiers = self.file.export_specs.iter();
        specifiers.map(|it| self.word(it.pos)).collect()
    }

    fn top_level_value_names(&self) -> Vec<u32> {
        let file = self.file;
        let mut names = Vec::new();
        for id in file.ids(file.body) {
            match file[id].kind {
                StmtKind::Var(declarations) => {
                    declarations.iter().for_each(|declaration: VarDeclId| {
                        self.identifiers(file[declaration].pat, &mut names)
                    })
                }
                StmtKind::Fn(function) => names.push(file[function].name_pos),
                StmtKind::Class(class) => names.push(file[class].name_pos),
                _ => {}
            }
        }
        names
    }

    fn nested_names(&self) -> FxHashSet<&'a [u8]> {
        let file = self.file;
        let top_level: FxHashSet<StmtId> = file.ids(file.body).collect();
        let at_top_level: FxHashSet<u32> = self.top_level_value_names().into_iter().collect();
        let is_nested = |statement: &StmtId| !top_level.contains(statement);
        let values = self.value_names().filter(|at| !at_top_level.contains(at));
        let types = (file.type_params.iter().map(|parameter| parameter.pos))
            .chain(
                file.interfaces
                    .iter()
                    .filter(|declared| is_nested(&declared.stmt))
                    .map(|declared| declared.name_pos),
            )
            .chain(
                file.aliases
                    .iter()
                    .filter(|declared| is_nested(&declared.stmt))
                    .map(|declared| declared.name_pos),
            )
            .chain(
                file.enums
                    .iter()
                    .filter(|declared| is_nested(&declared.stmt))
                    .map(|declared| declared.name_pos),
            )
            .chain(
                file.modules
                    .iter()
                    .filter(|declared| {
                        is_nested(&declared.stmt) && matches!(declared.name, ModuleName::Ident(_))
                    })
                    .map(|declared| declared.name_pos),
            );
        values.chain(types).map(|at| self.word(at)).collect()
    }

    fn top_level_declarations(&self) -> FxHashMap<&'a [u8], Declared> {
        let file = self.file;
        let mut declared: FxHashMap<&'a [u8], Declared> = FxHashMap::default();
        for id in file.ids(file.body) {
            let statement = &file[id];
            let is_type_only = self.is_type_only_statement(id);
            let mut names = Vec::new();
            match statement.kind {
                StmtKind::Fn(function) => names.push(file[function].name_pos),
                StmtKind::Class(class) => names.push(file[class].name_pos),
                StmtKind::Interface(interface) => names.push(file[interface].name_pos),
                StmtKind::TypeAlias(alias) => names.push(file[alias].name_pos),
                StmtKind::Enum(enum_statement) => names.push(file[enum_statement].name_pos),
                StmtKind::Module(module) if matches!(file[module].name, ModuleName::Ident(_)) => {
                    names.push(file[module].name_pos)
                }
                StmtKind::Var(declarations) => {
                    declarations.iter().for_each(|declaration: VarDeclId| {
                        self.identifiers(file[declaration].pat, &mut names)
                    })
                }
                StmtKind::Import(import) => {
                    let import = &file[import];
                    let default = import
                        .default
                        .is_some()
                        .then_some((import.default_pos, ImportedAs::Default));
                    let namespace = import
                        .namespace
                        .is_some()
                        .then_some((import.namespace_pos, ImportedAs::Namespace));
                    let named = import.named.iter().map(|specifier: ImportSpecId| {
                        (file[specifier].pos, ImportedAs::Named(specifier))
                    });
                    for (at, imported_as) in default.into_iter().chain(namespace).chain(named) {
                        let entry = declared.entry(self.word(at)).or_default();
                        entry.bindings.push(at);
                        entry.import = Some((id, imported_as));
                    }
                }
                StmtKind::ExportDefault(value) => {
                    let value = file.skip_type_assertions(value);
                    let entry = declared.entry(b"default").or_default();
                    entry
                        .bindings
                        .extend(file.exprs.get(value.idx()).map(|value| value.pos));
                    entry.is_default_expression = true;
                }
                _ => {}
            }
            for at in names
                .into_iter()
                .filter(|&at| at > 0 || statement.start == 0)
            {
                let entry = declared.entry(self.word(at)).or_default();
                entry.names.push(at);
                match is_type_only {
                    true => entry.statements.push(id),
                    false => entry.bindings.push(at),
                }
                entry.is_ambient_value |= is_type_only
                    && matches!(
                        statement.kind,
                        StmtKind::Var(_) | StmtKind::Class(_) | StmtKind::Enum(_) | StmtKind::Fn(_)
                    );
                match statement.kind {
                    StmtKind::Enum(_) if !is_type_only => entry.enum_statement = Some(id),
                    StmtKind::Class(class) => entry.type_parameters = file[class].type_params.len(),
                    StmtKind::Fn(function) => {
                        (entry.is_function, entry.type_parameters) =
                            (true, file[function].type_params.len())
                    }
                    _ => {}
                }
            }
        }
        declared
    }
}

struct NamespaceObject<'a> {
    name: &'a [u8],
    variable: &'a VarDecl,
    members: Vec<(&'a [u8], &'a [u8])>,
}

fn reserved_words() -> impl Iterator<Item = &'static [u8]> {
    const WORDS: &[u8] = b"any bigint boolean break case catch class const continue debugger \
        default delete do else enum export extends false finally for function if import in \
        instanceof never new null number object return string super switch symbol this throw true \
        try typeof undefined unknown var void while with yield let static await intrinsic infer \
        keyof readonly unique asserts abstract";
    bun_core::strings::split(WORDS, b" ")
}

#[derive(Default)]
struct Linked {
    hoisted: Vec<u8>,
    ambient_enums: FxHashSet<(usize, u32)>,
    ambient_signatures: FxHashSet<(usize, u32)>,
    replaced_statements: FxHashSet<(usize, u32)>,
    modules_of_untyped_values: Vec<Vec<u8>>,
    emitted_enums: FxHashMap<(u32, u32), Vec<u8>>,
    enum_names: FxHashMap<(u32, u32), Vec<u8>>,
}

fn link(
    written: &mut [Option<Written<'_, '_>>],
    paths: &[&[u8]],
    mapped: usize,
    output: &Syntax<'_, '_>,
    mappings: &Mappings,
    bundle: &Bundle<'_>,
) -> Linked {
    let index_of: FxHashMap<&[u8], usize> = paths
        .iter()
        .enumerate()
        .map(|(index, &path)| (path, index))
        .collect();
    let declared: Vec<FxHashMap<&[u8], Declared>> = written
        .iter()
        .map(|module| {
            module.as_ref().map_or_else(FxHashMap::default, |module| {
                module.syntax.top_level_declarations()
            })
        })
        .collect();
    let mut generated: FxHashMap<(u32, u32), u32> = FxHashMap::default();
    for &(offset, source, original) in &mappings.entries {
        generated.entry((source, original)).or_insert(offset);
    }
    let name_in_output = |module: usize, declared: &Declared| {
        declared
            .bindings
            .iter()
            .find_map(|&at| generated.get(&(module as u32, at)))
            .map(|&offset| output.word(offset))
    };

    let reserved: FxHashSet<&[u8]> = reserved_words().collect();
    let mut taken: FxHashSet<Vec<u8>> = reserved.iter().map(|word| word.to_vec()).collect();
    taken.extend(
        output
            .value_names()
            .chain(output.used_names())
            .chain(output.imported_names())
            .map(|at| output.word(at).to_vec()),
    );
    for module in written.iter().flatten() {
        let Some(types) = module.types else { continue };
        let resolved: FxHashSet<u32> = types
            .references
            .iter()
            .map(|reference| reference.0)
            .collect();
        let heads = module
            .syntax
            .file
            .names
            .iter()
            .filter(|name| !name.is_qualified() && !resolved.contains(&name.pos()));
        taken.extend(heads.map(|name| module.syntax.word(name.pos()).to_vec()));
    }

    let nested_names: Vec<FxHashSet<&[u8]>> = written
        .iter()
        .map(|module| {
            module
                .as_ref()
                .map_or_else(FxHashSet::default, |module| module.syntax.nested_names())
        })
        .collect();
    taken.extend(nested_names.iter().flatten().map(|name| name.to_vec()));

    let emitted: FxHashMap<usize, usize> = paths
        .iter()
        .enumerate()
        .filter_map(|(index, path)| {
            Some((index, *index_of.get(&emitted_declarations_path(path)?[..])?))
        })
        .collect();
    let emitted_from: FxHashMap<usize, usize> = emitted
        .iter()
        .map(|(&source, &declarations)| (declarations, source))
        .collect();
    let is_removed_without_written_type = |index: usize, name: &[u8]| {
        let (Some(found), Some(module)) = (declared[index].get(name), written[index].as_ref())
        else {
            return false;
        };
        let Some(&binding) = found
            .bindings
            .first()
            .filter(|_| found.import.is_none() && found.enum_statement.is_none())
        else {
            return false;
        };
        name_in_output(index, found)
            .filter(|_| index < mapped)
            .is_none()
            && module.syntax.overload_signatures(found).is_empty()
            && module
                .syntax
                .ambient_variable(binding, b"", module.types)
                .is_none()
            && module.syntax.ambient_function(binding, b"").is_none()
    };
    let declaring_place =
        |index: usize, name: Box<[u8]>| match (emitted.get(&index), emitted_from.get(&index)) {
            (Some(&declarations), _)
                if declared[declarations].contains_key(&name[..])
                    && is_removed_without_written_type(index, &name) =>
            {
                (declarations, name)
            }
            (_, Some(&source))
                if declared[source].contains_key(&name[..])
                    && !is_removed_without_written_type(source, &name) =>
            {
                (source, name)
            }
            _ => (index, name),
        };
    let place_of = |target: &Target| match target {
        Target::Declaration { path, name } => {
            Some(declaring_place(*index_of.get(&path[..])?, name.clone()))
        }
        Target::Module { .. } => None,
    };
    let mut wanted: FxHashSet<(usize, Box<[u8]>)> = FxHashSet::default();
    let mut queue: Vec<(usize, Box<[u8]>)> = Vec::new();
    for module in written.iter().take(mapped).flatten() {
        queue.extend(module.types.iter().flat_map(|types| {
            types
                .references
                .iter()
                .filter_map(|reference| place_of(&reference.1))
        }));
    }
    let entry = bundle
        .entry_point
        .and_then(|path| index_of.get(path))
        .and_then(|&index| written[index].as_ref())
        .and_then(|module| module.types);
    queue.extend(entry.iter().flat_map(|types| {
        types
            .exports
            .iter()
            .filter_map(|export| place_of(&export.1))
    }));
    let exports_of_entry = entry.map_or(&[][..], |types| &types.exports[..]);
    #[allow(
        clippy::disallowed_methods,
        reason = "adjacent-pair check, not a byte search"
    )]
    let exported_twice: FxHashSet<&[u8]> = exports_of_entry
        .windows(2)
        .filter(|pair| pair[0].0 == pair[1].0)
        .map(|pair| &pair[0].0[..])
        .collect();
    taken.extend(exported_twice.iter().map(|name| name.to_vec()));
    let mut augmentations: Vec<(usize, StmtId)> = Vec::new();
    for (index, module) in written.iter().enumerate().skip(mapped) {
        let Some((module, types)) = module
            .as_ref()
            .and_then(|module| Some((module, module.types?)))
        else {
            continue;
        };
        let file = module.syntax.file;
        for id in file.ids(file.body).filter(|&id| matches!(file[id].kind, StmtKind::Module(declared) if !matches!(file[declared].name, ModuleName::Ident(_)))) {
            augmentations.push((index, id));
            let inside = types.references.iter().filter(|reference| file[id].start <= reference.0 && reference.0 < file[id].loc.end);
            queue.extend(inside.filter_map(|reference| place_of(&reference.1)));
        }
    }
    while let Some(place) = queue.pop() {
        if !wanted.insert(place.clone()) {
            continue;
        }
        let (index, name) = place;
        let (Some(found), Some(module)) = (declared[index].get(&name[..]), written[index].as_ref())
        else {
            continue;
        };
        let Some(types) = module.types.filter(|_| index >= mapped) else {
            continue;
        };
        let statements = found
            .statements
            .iter()
            .chain(&found.enum_statement)
            .map(|&statement| {
                (
                    module.syntax.file[statement].start,
                    module.syntax.file[statement].loc.end,
                )
            });
        let ambient = found.bindings.first().and_then(|&binding| {
            module
                .syntax
                .ambient_variable(binding, b"", module.types)
                .or_else(|| module.syntax.ambient_function(binding, b""))
        });
        let ambient = ambient
            .into_iter()
            .flatten()
            .filter_map(|piece| match piece {
                Piece::Source(start, end) => Some((start, end)),
                Piece::Text(_) => None,
            });
        for (start, end) in statements.chain(ambient) {
            let inside = types
                .references
                .iter()
                .filter(|reference| start <= reference.0 && reference.0 < end);
            queue.extend(inside.filter_map(|reference| place_of(&reference.1)));
        }
    }

    let declared_in_output: FxHashSet<&[u8]> = output
        .top_level_value_names()
        .into_iter()
        .map(|at| output.word(at))
        .collect();
    let mut names: Vec<FxHashMap<&[u8], Vec<u8>>> = vec![FxHashMap::default(); written.len()];
    let mut values: Vec<FxHashMap<&[u8], &[u8]>> = vec![FxHashMap::default(); written.len()];
    let mut imports: FxHashMap<Vec<u8>, Vec<u8>> = FxHashMap::default();
    let mut linked = Linked::default();
    let mut ambient_values: Vec<(usize, Vec<Piece>)> = Vec::new();
    let unique = |name: &[u8], taken: &mut FxHashSet<Vec<u8>>| {
        let mut candidate = name.to_vec();
        let mut number = 1;
        while !taken.insert(candidate.clone()) {
            number += 1;
            candidate = [name, number.to_string().as_bytes()].concat();
        }
        candidate
    };
    for (index, module) in written.iter().enumerate() {
        let Some(module) = module else { continue };
        let mut in_order: Vec<(&[u8], &Declared)> = declared[index]
            .iter()
            .map(|(&name, found)| (name, found))
            .collect();
        in_order.sort_by_key(|(_, found)| {
            found
                .names
                .first()
                .or_else(|| found.bindings.first())
                .copied()
        });
        for (name, found) in in_order {
            if declaring_place(index, Box::from(name)).0 != index {
                linked.replaced_statements.extend(
                    found
                        .statements
                        .iter()
                        .map(|statement| (index, statement.0)),
                );
                continue;
            }
            let is_wanted = wanted.contains(&(index, Box::from(name)));
            if let Some(in_output) = name_in_output(index, found).filter(|_| index < mapped) {
                values[index].insert(name, in_output);
                let Some(enum_statement) = found.enum_statement else {
                    names[index].insert(name, in_output.to_vec());
                    continue;
                };
                linked.ambient_enums.insert((index, enum_statement.0));
                let ambient = unique(name, &mut taken);
                linked.emitted_enums.extend(
                    found
                        .bindings
                        .iter()
                        .map(|&at| ((index as u32, at), ambient.clone())),
                );
                let file = module.syntax.file;
                let members = found
                    .names
                    .iter()
                    .flat_map(|&at| {
                        file.enums
                            .iter()
                            .filter(move |declared| declared.name_pos == at)
                    })
                    .flat_map(|declared| declared.members.iter());
                let members = members
                    .map(|member: EnumMemberId| &file[member])
                    .filter(|member| {
                        member.name_kind == NameKind::Identifier && member.name.is_some()
                    })
                    .map(|member| module.syntax.word(member.pos))
                    .filter(|&name| !reserved.contains(name));
                let members: Vec<Vec<u8>> = members
                    .map(|member| {
                        [
                            &b"export type "[..],
                            member,
                            b" = ",
                            &ambient,
                            b".",
                            member,
                            b";",
                        ]
                        .concat()
                    })
                    .collect();
                let is_exported_in_place =
                    output.file.stmts.iter().enumerate().any(|(id, statement)| {
                        let StmtKind::Var(declarations) = statement.kind else {
                            return false;
                        };
                        output
                            .file
                            .modifiers_to_flags(output.file.stmt_modifiers(StmtId(id as u32)))
                            .contains(Flags::EXPORT)
                            && declarations.iter().any(|declaration: VarDeclId| {
                                output.word(output.file[output.file[declaration].pat].pos)
                                    == in_output
                            })
                    });
                let export: &[u8] = if is_exported_in_place {
                    b"export "
                } else {
                    b""
                };
                linked.hoisted.extend_from_slice(
                    &[
                        export,
                        b"type ",
                        in_output,
                        b" = ",
                        &ambient,
                        b";\n",
                        export,
                        b"declare namespace ",
                        in_output,
                        b" { ",
                        &members.join(&b" "[..]),
                        b" }\n",
                    ]
                    .concat(),
                );
                names[index].insert(name, ambient);
                continue;
            }
            if found.is_default_expression
                || !is_wanted && (index >= mapped || found.statements.is_empty())
            {
                continue;
            }
            if let Some((statement, imported_as)) = found.import {
                let (file, statement) = (module.syntax.file, &module.syntax.file[statement]);
                let StmtKind::Import(import) = statement.kind else {
                    continue;
                };
                let span = file[import].clause_end as usize..statement.loc.end as usize;
                let tail = module.syntax.text[span].trim_ascii();
                let is_relative = bun_core::strings::index_of_any(tail, b"\"'")
                    .is_some_and(|quote| matches!(tail.get(quote + 1), Some(b'.' | b'/')));
                if is_relative && found.statements.is_empty() {
                    continue;
                }
                if is_relative {
                    names[index].insert(name, unique(name, &mut taken));
                    continue;
                }
                let imported = match imported_as {
                    ImportedAs::Default => &b"default"[..],
                    ImportedAs::Namespace => b"*",
                    ImportedAs::Named(specifier) => {
                        module.syntax.word(file[specifier].imported_pos)
                    }
                };
                let key = [imported, b" ", tail].concat();
                if let Some(known) = imports.get(&key) {
                    names[index].insert(name, known.clone());
                    continue;
                }
                let local = unique(name, &mut taken);
                let clause = match imported_as {
                    ImportedAs::Default => local.clone(),
                    ImportedAs::Namespace => [&b"* as "[..], &local[..]].concat(),
                    ImportedAs::Named(_) if imported == &local[..] => {
                        [&b"{ "[..], imported, b" }"].concat()
                    }
                    ImportedAs::Named(_) => {
                        [&b"{ "[..], imported, b" as ", &local[..], b" }"].concat()
                    }
                };
                let semicolon: &[u8] = if tail.ends_with(b";") { b"" } else { b";" };
                linked.hoisted.extend_from_slice(
                    &[
                        &b"import type "[..],
                        &clause[..],
                        b" ",
                        tail,
                        semicolon,
                        b"\n",
                    ]
                    .concat(),
                );
                imports.insert(key, local.clone());
                names[index].insert(name, local);
                continue;
            }
            if found.is_ambient_value
                && found.bindings.is_empty()
                && !emitted_from.contains_key(&index)
                && !declared_in_output.contains(name)
            {
                taken.insert(name.to_vec());
                names[index].insert(name, name.to_vec());
                continue;
            }
            let local = unique(name, &mut taken);
            if let Some(enum_statement) = found.enum_statement {
                linked.ambient_enums.insert((index, enum_statement.0));
            } else if let signatures = module.syntax.overload_signatures(found)
                && !signatures.is_empty()
            {
                linked
                    .ambient_signatures
                    .extend(signatures.iter().map(|signature| (index, signature.0)));
            } else if let Some(pieces) = found.bindings.first().and_then(|&binding| {
                module
                    .syntax
                    .ambient_variable(binding, &local, module.types)
                    .or_else(|| module.syntax.ambient_function(binding, &local))
            }) {
                ambient_values.push((index, pieces));
            } else if !found.bindings.is_empty() {
                linked.modules_of_untyped_values.push(paths[index].to_vec());
                let parameters: Vec<Vec<u8>> = (0..found.type_parameters)
                    .map(|number| format!("T{number} = any").into_bytes())
                    .collect();
                let parameters = if parameters.is_empty() {
                    Vec::new()
                } else {
                    [&b"<"[..], &parameters.join(&b", "[..])[..], b">"].concat()
                };
                if found.is_function {
                    linked.hoisted.extend_from_slice(
                        &[
                            &b"declare function "[..],
                            &local[..],
                            &parameters[..],
                            b"(...parameters: any[]): any;\n",
                        ]
                        .concat(),
                    );
                } else {
                    linked.hoisted.extend_from_slice(
                        &[&b"declare const "[..], &local[..], b": any;\n"].concat(),
                    );
                }
                if found.statements.is_empty() && !found.is_function {
                    linked.hoisted.extend_from_slice(
                        &[&b"type "[..], &local[..], &parameters[..], b" = any;\n"].concat(),
                    );
                }
            }
            names[index].insert(name, local);
        }
    }

    let final_name =
        |target: &Target| place_of(target).and_then(|(index, name)| names[index].get(&name[..]));
    let mut namespace_objects: FxHashMap<&[u8], &[u8]> = FxHashMap::default();
    let objects = output.namespace_objects();
    let mut matched_objects: FxHashSet<&[u8]> = FxHashSet::default();
    for object in objects.iter().chain(&objects).chain(&objects) {
        if matched_objects.contains(object.name) {
            continue;
        }
        let value_of = |target: &Target| match target {
            Target::Declaration { path, name } => {
                values[*index_of.get(&path[..])?].get(&name[..]).copied()
            }
            Target::Module { path } => namespace_objects.get(&path[..]).copied(),
        };
        let candidates = written
            .iter()
            .flatten()
            .filter_map(|module| module.types)
            .filter(|types| {
                let exports: FxHashMap<&[u8], &Target> = types
                    .exports
                    .iter()
                    .map(|export| (&export.0[..], &export.1))
                    .collect();
                !object.members.is_empty()
                    && object.members.iter().all(|(name, local)| {
                        exports.get(name).and_then(|target| value_of(target)) == Some(*local)
                    })
            });
        let Some(types) = candidates.min_by_key(|types| types.exports.len()) else {
            continue;
        };
        namespace_objects.insert(&types.path[..], object.name);
        matched_objects.insert(object.name);
        let values: FxHashSet<&[u8]> = object.members.iter().map(|member| member.0).collect();
        let is_only_a_type = |target: &Target| {
            place_of(target)
                .and_then(|(index, name)| {
                    declared[index]
                        .get(&name[..])
                        .map(|found| found.bindings.is_empty() && !found.is_ambient_value)
                })
                .unwrap_or(false)
        };
        let only_types = types
            .exports
            .iter()
            .filter(|export| !values.contains(&export.0[..]) && is_only_a_type(&export.1))
            .filter_map(|export| Some((&export.0[..], final_name(&export.1)?)));
        let only_types: Vec<Vec<u8>> = only_types
            .map(|(name, local)| {
                if &local[..] == name {
                    local.clone()
                } else {
                    [&local[..], b" as ", name].concat()
                }
            })
            .collect();
        if !only_types.is_empty() {
            linked.hoisted.extend_from_slice(
                &[
                    &b"declare namespace "[..],
                    object.name,
                    b" { export type { ",
                    &only_types.join(&b", "[..]),
                    b" }; }\n",
                ]
                .concat(),
            );
        }
    }
    let outer_scope = unique(b"outer", &mut taken);
    let mut shadowed: Vec<Vec<u8>> = Vec::new();
    let namespace_pairs: FxHashMap<&[u8], Vec<u8>> = objects
        .iter()
        .map(|object| (object.name, unique(object.name, &mut taken)))
        .collect();
    let mut pending_pairs: Vec<&[u8]> = Vec::new();
    let mut all_edits: Vec<Vec<(u32, u32, Vec<u8>)>> = Vec::new();
    for (index, module) in written.iter().enumerate() {
        let mut edits: Vec<(u32, u32, Vec<u8>)> = Vec::new();
        if let Some((module, types)) = module
            .as_ref()
            .and_then(|module| Some((module, module.types?)))
        {
            let syntax = &module.syntax;
            let targets: FxHashMap<u32, &Target> = types
                .references
                .iter()
                .map(|reference| (reference.0, &reference.1))
                .collect();
            let list = &syntax.file.names;
            let mut start_of_import_type: FxHashMap<u32, u32> = FxHashMap::default();
            for node in syntax.file.types.iter() {
                if let TypeNodeKind::Import {
                    name,
                    is_typeof: false,
                    ..
                } = node.kind
                    && let Some(first) = list.get(name.start as usize).filter(|_| !name.is_empty())
                {
                    start_of_import_type.insert(first.pos(), node.pos);
                }
            }
            for (number, name) in list.iter().enumerate() {
                let (at, end) = (name.pos(), syntax.token_end(name.pos()));
                let import_type = start_of_import_type.get(&at).copied();
                if name.is_qualified() && import_type.is_none() {
                    continue;
                }
                match targets.get(&at).copied() {
                    Some(target @ Target::Declaration { .. }) => {
                        if let Some(new) = final_name(target)
                            .filter(|new| import_type.is_some() || &new[..] != syntax.word(at))
                        {
                            edits.push((import_type.unwrap_or(at), end, new.clone()));
                        }
                    }
                    Some(Target::Module { path }) => {
                        let (mut last, mut module) = (name, path);
                        let mut member = None;
                        for next in list[number + 1..]
                            .iter()
                            .take_while(|next| next.is_qualified())
                        {
                            match targets.get(&next.pos()) {
                                Some(Target::Module { path }) => (last, module) = (next, path),
                                _ => {
                                    member = Some(next);
                                    break;
                                }
                            }
                        }
                        let new = match member {
                            Some(member) => targets
                                .get(&member.pos())
                                .and_then(|target| final_name(target))
                                .cloned(),
                            None => namespace_objects.get(&module[..]).map(|&object| {
                                pending_pairs.push(object);
                                namespace_pairs[object].clone()
                            }),
                        };
                        if let Some(new) = new {
                            edits.push((
                                import_type.unwrap_or(at),
                                syntax.token_end(member.unwrap_or(last).pos()),
                                new,
                            ));
                        }
                    }
                    None => {}
                }
            }
            for (id, expr) in syntax
                .file
                .exprs
                .iter()
                .enumerate()
                .filter(|(_, expr)| is_inside(&module.type_ranges, expr.pos))
            {
                match expr.kind {
                    ExprKind::Ident(_) => {
                        if let Some(new) = targets
                            .get(&expr.pos)
                            .and_then(|target| final_name(target))
                            .filter(|new| &new[..] != syntax.word(expr.pos))
                        {
                            edits.push((expr.pos, expr.end, new.clone()));
                        }
                    }
                    ExprKind::Dot { obj, .. } => {
                        let name_pos = syntax.file.name_pos(ExprId(id as u32));
                        let is_module = syntax.file.exprs.get(obj.idx()).is_some_and(|object| {
                            matches!(targets.get(&object.pos), Some(Target::Module { .. }))
                        });
                        if let Some(new) = targets
                            .get(&name_pos)
                            .and_then(|target| final_name(target))
                            .filter(|_| is_module)
                        {
                            edits.push((expr.pos, syntax.token_end(name_pos), new.clone()));
                        }
                    }
                    _ => {}
                }
            }
            for (start, path) in &types.augmented_modules {
                let Some(&augmented) = index_of.get(&path[..]) else {
                    continue;
                };
                let Some(StmtKind::Module(declared)) = syntax
                    .file
                    .stmts
                    .iter()
                    .find(|statement| statement.start == *start)
                    .map(|statement| statement.kind)
                else {
                    continue;
                };
                for inner in syntax
                    .file
                    .ids(syntax.file[declared].body)
                    .map(|inner| &syntax.file[inner])
                {
                    let at = match inner.kind {
                        StmtKind::Interface(interface) => syntax.file[interface].name_pos,
                        StmtKind::Module(module) => syntax.file[module].name_pos,
                        StmtKind::Class(class) => syntax.file[class].name_pos,
                        StmtKind::Enum(declared) => syntax.file[declared].name_pos,
                        StmtKind::Fn(function) => syntax.file[function].name_pos,
                        _ => continue,
                    };
                    let (place, name) = declaring_place(augmented, Box::from(syntax.word(at)));
                    if let Some(new) = names[place].get(&name[..]) {
                        edits.push((at, syntax.token_end(at), new.clone()));
                    }
                }
            }
            for &(at, binding) in types.locals.iter().filter(|_| index < mapped) {
                if let Some(new) = generated
                    .get(&(index as u32, binding))
                    .map(|&offset| output.word(offset))
                    .filter(|new| *new != syntax.word(at))
                {
                    edits.push((at, syntax.token_end(at), new.to_vec()));
                }
            }
            edits.extend(
                types
                    .globals
                    .iter()
                    .filter(|&&at| declared_in_output.contains(syntax.word(at)))
                    .map(|&at| (at, at, b"globalThis.".to_vec())),
            );
            for &at in &types.enum_objects {
                if let Some(new) = targets.get(&at).and_then(|target| final_name(target)) {
                    linked.enum_names.insert((index as u32, at), new.clone());
                }
            }
            for (&name, found) in &declared[index] {
                if let Some(new) = names[index].get(name).filter(|new| &new[..] != name) {
                    let is_type_only = |at: &&u32| {
                        is_inside(&module.type_ranges, **at) || found.enum_statement.is_some()
                    };
                    edits.extend(
                        found
                            .names
                            .iter()
                            .filter(is_type_only)
                            .map(|&at| (at, syntax.token_end(at), new.clone())),
                    );
                }
            }
            edits.sort();
            edits.dedup_by_key(|edit| edit.0);
            for edit in edits.iter_mut().filter(|edit| {
                nested_names[index].contains(&edit.2[..])
                    && !declared[index]
                        .values()
                        .any(|found| found.names.contains(&edit.0))
            }) {
                shadowed.push(edit.2.clone());
                edit.2 = [&outer_scope[..], b".", &edit.2].concat();
            }
        }
        all_edits.push(edits);
    }

    shadowed.sort();
    shadowed.dedup();
    if !shadowed.is_empty() {
        linked.hoisted.extend_from_slice(
            &[
                &b"declare namespace "[..],
                &outer_scope,
                b" { export type { ",
                &shadowed.join(&b", "[..]),
                b" }; }\n",
            ]
            .concat(),
        );
    }
    let mut declared_pairs: FxHashSet<&[u8]> = FxHashSet::default();
    while let Some(name) = pending_pairs.pop() {
        let Some(object) = objects
            .iter()
            .find(|object| object.name == name)
            .filter(|_| declared_pairs.insert(name))
        else {
            continue;
        };
        let members =
            object
                .members
                .iter()
                .map(|&(name, local)| match namespace_pairs.get(local) {
                    Some(twin) => {
                        pending_pairs.push(local);
                        [name, &b": typeof "[..], twin].concat()
                    }
                    None => [name, &b": typeof "[..], local].concat(),
                });
        let members: Vec<Vec<u8>> = members.collect();
        linked.hoisted.extend_from_slice(
            &[
                &b"declare const "[..],
                &namespace_pairs[name],
                b": { ",
                &members.join(&b"; "[..]),
                b" };\n",
            ]
            .concat(),
        );
    }
    let exported = output.exported_names();
    for (name, target) in entry.iter().flat_map(|types| types.exports.iter()) {
        if exported.contains(&name[..])
            && exported_twice.contains(&name[..])
            && matches!(target, Target::Declaration { .. })
        {
            let is_generic = place_of(target)
                .and_then(|(index, name)| declared[index].get(&name[..]))
                .is_none_or(|found| found.type_parameters > 0);
            if let Some(local) = final_name(target).filter(|_| !is_generic) {
                linked.hoisted.extend_from_slice(
                    &[&b"export type "[..], &name[..], b" = ", &local[..], b";\n"].concat(),
                );
            }
        }
        let Some(local) = final_name(target).filter(|_| !exported.contains(&name[..])) else {
            continue;
        };
        let clause = if local[..] == name[..] {
            local.clone()
        } else {
            [&local[..], b" as ", &name[..]].concat()
        };
        linked
            .hoisted
            .extend_from_slice(&[&b"export type { "[..], &clause[..], b" };\n"].concat());
    }
    let mut hoisted_statements = augmentations;
    for (index, name) in &wanted {
        if *index >= mapped
            && let Some(found) = declared[*index].get(&name[..])
        {
            hoisted_statements.extend(
                found
                    .statements
                    .iter()
                    .chain(&found.enum_statement)
                    .map(|&statement| (*index, statement))
                    .filter(|&(index, statement)| {
                        !linked.replaced_statements.contains(&(index, statement.0))
                    }),
            );
        }
    }
    hoisted_statements.extend(
        linked
            .ambient_signatures
            .iter()
            .map(|&(index, statement)| (index, StmtId(statement))),
    );
    hoisted_statements.sort();
    hoisted_statements.dedup();
    drop(names);
    drop(declared);
    for (module, edits) in written.iter_mut().zip(all_edits) {
        if let Some(module) = module {
            module.edits = edits;
        }
    }
    let mut declarations = Vec::new();
    for (index, statement) in hoisted_statements {
        let Some(module) = &written[index] else {
            continue;
        };
        if module
            .syntax
            .file
            .comment_directives
            .iter()
            .any(|directive| {
                module.syntax.after_trivia(directive.end) == module.syntax.file[statement].start
            })
        {
            declarations.extend_from_slice(b"// @ts-ignore\n");
        }
        if linked.ambient_enums.contains(&(index, statement.0))
            || linked.ambient_signatures.contains(&(index, statement.0))
        {
            declarations.extend_from_slice(b"declare ");
        }
        let merged = module.merged_augmentation_text(&module.syntax.file[statement]);
        declarations.extend_from_slice(
            &merged.unwrap_or_else(|| {
                module.statement_text(statement, Flags::EXPORT | Flags::DEFAULT)
            }),
        );
        declarations.push(b'\n');
    }
    for (index, pieces) in ambient_values {
        let Some(module) = &written[index] else {
            continue;
        };
        for piece in pieces {
            match piece {
                Piece::Text(text) => declarations.extend_from_slice(&text),
                Piece::Source(start, end) => {
                    declarations.extend_from_slice(&module.text(start, end))
                }
            }
        }
    }
    linked.hoisted = [declarations, std::mem::take(&mut linked.hoisted)].concat();
    linked
}

fn add_types(
    path: &[u8],
    javascript: &[u8],
    mappings: &[u8],
    sources: &[Source<'_>],
    bundle: &Bundle<'_>,
) -> Result<TypedText, String> {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let mut mappings = Mappings::decode(mappings, javascript, sources)?;
    let mut output_file = parse(&session, &atoms, &[path, b".ts"].concat(), javascript)?;
    let line_breaks = Syntax {
        file: &output_file,
        text: javascript,
    }
    .missing_line_breaks();
    let mut insertions = Insertions { list: Vec::new() };
    for &offset in &line_breaks {
        insertions.add(offset, Order::Line, b"\n".to_vec());
    }
    let javascript = &insertions.apply(javascript)[..];
    if !line_breaks.is_empty() {
        for entry in &mut mappings.entries {
            entry.0 += line_breaks.partition_point(|&offset| offset <= entry.0) as u32;
        }
        output_file = parse(&session, &atoms, &[path, b".ts"].concat(), javascript)?;
    }
    let output = Syntax {
        file: &output_file,
        text: javascript,
    };
    let modules = bundle.modules;
    let mut texts: Vec<(&[u8], &[u8], Option<&ModuleTypes>)> = sources
        .iter()
        .map(|source| {
            (
                source.path,
                source.text,
                modules
                    .iter()
                    .find(|module| &module.path[..] == source.path),
            )
        })
        .collect();
    texts.extend(
        modules
            .iter()
            .chain(bundle.emitted_declarations)
            .filter(|module| !sources.iter().any(|source| source.path == &module.path[..]))
            .map(|module| (&module.path[..], &module.text[..], Some(module))),
    );
    let mut files = Vec::new();
    for &(path, text, _) in &texts {
        files.push(match is_typescript(path) {
            true => Some(parse(&session, &atoms, path, text)?),
            false => None,
        });
    }
    let mut written: Vec<Option<Written<'_, '_>>> = Vec::new();
    let mut source_slots: FxHashMap<(Place, u32, u32), Slot> = FxHashMap::default();
    let mut optional_parameter_properties: FxHashMap<(u32, u32), (u32, bool)> =
        FxHashMap::default();
    for (index, (file, &(_, text, types))) in files.iter().zip(&texts).enumerate() {
        let Some(file) = file else {
            written.push(None);
            continue;
        };
        let syntax = Syntax { file, text };
        let mut type_ranges = syntax.type_only_declarations();
        let declarations = merged(type_ranges.clone());
        for slot in outermost_only(syntax.slots(), &type_ranges) {
            source_slots.insert((slot.place, index as u32, slot.key), slot);
            type_ranges.push((slot.start, slot.end));
        }
        type_ranges.extend(syntax.cast_type_spans());
        for (parameter, id) in file
            .params
            .iter()
            .zip(0..)
            .filter(|(parameter, _)| parameter.flags.contains(Flags::PARAMETER_PROPERTY))
        {
            let Some(binding) = syntax.binding_slot(
                parameter.pat,
                parameter.ty,
                parameter.flags.contains(Flags::OPTIONAL),
            ) else {
                continue;
            };
            source_slots.insert(
                (Place::MemberType, index as u32, binding.key),
                Slot {
                    place: Place::MemberType,
                    ..binding
                },
            );
            if let Some(annotation) = parameter
                .ty
                .some()
                .filter(|_| parameter.flags.contains(Flags::OPTIONAL))
            {
                let is_parenthesized_in_a_union = matches!(
                    file[annotation].kind,
                    TypeNodeKind::Fn(_) | TypeNodeKind::Cond { .. }
                );
                optional_parameter_properties.insert(
                    (index as u32, binding.key),
                    (syntax.type_span(annotation).0, is_parenthesized_in_a_union),
                );
            }
            for modifier in file.modifier_list(file.param_modifiers(ParamId(id))) {
                let flag = modifier.kind.flag();
                let place = if flag.intersects(Flags::PUBLIC | Flags::PRIVATE | Flags::PROTECTED) {
                    Place::MemberStart
                } else if flag.contains(Flags::READONLY) {
                    Place::MemberName
                } else {
                    continue;
                };
                source_slots.insert(
                    (place, index as u32, binding.key),
                    Slot {
                        place,
                        key: binding.key,
                        start: modifier.pos,
                        end: syntax.token_end(modifier.pos),
                    },
                );
            }
        }
        written.push(Some(Written {
            syntax,
            types,
            type_ranges: merged(type_ranges),
            declarations,
            edits: Vec::new(),
        }));
    }
    let paths: Vec<&[u8]> = texts.iter().map(|text| text.0).collect();
    let type_references: FxHashSet<(&[u8], &[u8])> = (texts.iter().filter_map(|text| text.2))
        .flat_map(|types| &types.references)
        .filter_map(|reference| match &reference.1 {
            Target::Declaration { path, name } => Some((&path[..], &name[..])),
            Target::Module { .. } => None,
        })
        .collect();
    let linked = link(
        &mut written,
        &paths,
        sources.len(),
        &output,
        &mappings,
        bundle,
    );
    let mut transfer = Transfer {
        javascript,
        output: &output,
        mappings: &mappings,
        modules: &written[..sources.len()],
        linked: &linked,
        type_references,
        insertions: Insertions { list: Vec::new() },
        dropped_casts: 0,
        hoisted: Vec::new(),
        optional_parameter_properties,
    };
    transfer.copy_slots(&source_slots);
    transfer.annotate_generated_code();
    transfer.copy_casts();
    transfer.type_enum_and_namespace_objects();
    transfer.copy_statements();
    transfer.copy_directives();
    transfer.copy_members();
    transfer.finish()
}

struct Transfer<'t, 'a, 's> {
    javascript: &'a [u8],
    output: &'t Syntax<'a, 's>,
    mappings: &'t Mappings,
    modules: &'t [Option<Written<'a, 's>>],
    linked: &'t Linked,
    type_references: FxHashSet<(&'t [u8], &'t [u8])>,
    insertions: Insertions,
    dropped_casts: usize,
    hoisted: Vec<u8>,
    optional_parameter_properties: FxHashMap<(u32, u32), (u32, bool)>,
}

impl<'a> Transfer<'_, 'a, '_> {
    fn anchored_expressions(&self) -> FxHashMap<(u32, u32), ExprId> {
        let (output, mappings) = (self.output, self.mappings);
        let mut anchored: FxHashMap<(u32, u32), ExprId> = FxHashMap::default();
        for (key, value) in output.anchored_expressions() {
            if let Some(original) = mappings.original(key) {
                anchored.entry(original).or_insert(value);
            }
        }
        anchored
    }

    fn copy_slots(&mut self, source_slots: &FxHashMap<(Place, u32, u32), Slot>) {
        let (output, mappings, written, linked) =
            (self.output, self.mappings, self.modules, self.linked);
        let (output_file, insertions) = (output.file, &mut self.insertions);
        let parameter_count_of: FxHashMap<u32, usize> = output_file
            .fns
            .iter()
            .map(|function| (Syntax::function_key(function), function.params.len()))
            .collect();
        for slot in &output.slots() {
            let Some((source, key)) = mappings.original(slot.key) else {
                continue;
            };
            if slot.place == Place::Binding
                && let Some(ambient) = linked.emitted_enums.get(&(source, key))
            {
                let is_variable = output_file
                    .var_decls
                    .iter()
                    .any(|declaration| output_file[declaration.pat].pos == slot.key);
                insertions.add(
                    slot.start,
                    Order::Slot,
                    if is_variable {
                        [&b"!: typeof "[..], ambient].concat()
                    } else {
                        b": any".to_vec()
                    },
                );
                continue;
            }
            let Some(module) = written[source as usize]
                .as_ref()
                .filter(|module| !module.is_unchecked())
            else {
                continue;
            };
            let Some(found) = source_slots.get(&(slot.place, source, key)) else {
                if slot.place == Place::ReturnType
                    && module
                        .types
                        .is_some_and(|types| types.functions_returning_undefined.contains(&key))
                {
                    insertions.add(slot.start, Order::Slot, b": undefined".to_vec());
                }
                continue;
            };
            let text = module.trimmed_text(found.start, found.end);
            let is_computed = module.syntax.is_in_computed_key(found.key);
            let (order, text) = match slot.place {
                Place::MemberType
                    if is_computed
                        && text.starts_with(b":")
                        && output.byte(output.after_trivia(slot.start)) != b'=' =>
                {
                    (Order::Slot, [&b"!"[..], &text].concat())
                }
                Place::MemberType
                    if self
                        .optional_parameter_properties
                        .contains_key(&(source, key)) =>
                {
                    let (annotation, is_parenthesized) =
                        self.optional_parameter_properties[&(source, key)];
                    let (open, close): (&[u8], &[u8]) = if is_parenthesized {
                        (b" (", b") | undefined")
                    } else {
                        (b" ", b" | undefined")
                    };
                    (
                        Order::Slot,
                        [
                            &module.trimmed_text(found.start, annotation)[..],
                            open,
                            &module.trimmed_text(annotation, found.end),
                            close,
                        ]
                        .concat(),
                    )
                }
                Place::Implements => (Order::Slot, [&b" "[..], &text[..]].concat()),
                Place::ClassKeyword | Place::MemberName => {
                    (Order::MemberName, [&text[..], b" "].concat())
                }
                Place::MemberStart => (Order::MemberStart, [&text[..], b" "].concat()),
                Place::ThisParameter => {
                    let text = text.strip_suffix(b",").unwrap_or(&text).trim_ascii();
                    let has_more = parameter_count_of
                        .get(&slot.key)
                        .is_some_and(|&count| count > 0);
                    (
                        Order::Slot,
                        [text, if has_more { &b", "[..] } else { b"" }].concat(),
                    )
                }
                Place::TypeArguments
                    if slot.key < slot.start && output.word(slot.key) == b"new" =>
                {
                    (Order::Close(slot.start - slot.key - 1), text)
                }
                _ => (Order::Slot, text),
            };
            insertions.add(slot.start, order, text);
        }
    }

    fn annotate_generated_code(&mut self) {
        let (output, mappings) = (self.output, self.mappings);
        let (output_file, insertions) = (output.file, &mut self.insertions);
        for function in output_file.fns.iter() {
            let Some(open) = output
                .open_parenthesis(function)
                .filter(|_| Syntax::has_javascript(function))
            else {
                continue;
            };
            let is_mapped = |parameter: ParamId| {
                output
                    .first_identifier(output_file[parameter].pat)
                    .is_some_and(|name| mappings.original(name).is_some())
            };
            if mappings.original(Syntax::function_key(function)).is_some()
                || function.params.iter().any(is_mapped)
            {
                continue;
            }
            if matches!(function.kind, FnKind::Decl | FnKind::Expr) {
                insertions.add(
                    open + 1,
                    Order::Slot,
                    if function.params.is_empty() {
                        b"this: any".to_vec()
                    } else {
                        b"this: any, ".to_vec()
                    },
                );
            }
            let parameters: Vec<&Param> = function
                .params
                .iter()
                .map(|parameter| &output_file[parameter])
                .collect();
            let may_be_left_out = |parameter: &&Param| {
                parameter.flags.contains(Flags::REST)
                    || parameter.default.is_some()
                    || matches!(output_file[parameter.pat].kind, PatKind::Ident(_))
            };
            let required = parameters
                .iter()
                .rposition(|parameter| !may_be_left_out(parameter))
                .map_or(0, |last| last + 1);
            for (place, parameter) in parameters.iter().enumerate() {
                let is_optional = place >= required && parameter.default.is_none();
                let annotation: &[u8] = if parameter.flags.contains(Flags::REST) {
                    b": any[]"
                } else if is_optional {
                    b"?: any"
                } else {
                    b": any"
                };
                insertions.add(
                    output_file[parameter.pat].end,
                    Order::Slot,
                    annotation.to_vec(),
                );
            }
        }
        let mut unannotatable: FxHashSet<u32> = FxHashSet::default();
        for statement in output_file.stmts.iter() {
            match statement.kind {
                StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => {
                    if let Some(StmtKind::Var(declarations)) =
                        output_file.stmts.get(left.idx()).map(|left| left.kind)
                    {
                        unannotatable.extend(
                            declarations
                                .iter()
                                .map(|declaration: VarDeclId| declaration.0),
                        );
                    }
                }
                StmtKind::Try { param, .. } => drop(unannotatable.insert(param.0)),
                _ => {}
            }
        }
        for (declaration, id) in output_file
            .var_decls
            .iter()
            .zip(0u32..)
            .filter(|(declaration, _)| declaration.init.is_none())
        {
            let pattern = &output_file[declaration.pat];
            if matches!(pattern.kind, PatKind::Ident(_))
                && mappings.original(pattern.pos).is_none()
                && !unannotatable.contains(&id)
            {
                insertions.add(pattern.end, Order::Slot, b": any".to_vec());
            }
        }
    }

    fn copy_casts(&mut self) {
        let output_anchored = self.anchored_expressions();
        let (output, mappings, written, linked) =
            (self.output, self.mappings, self.modules, self.linked);
        let (output_file, insertions) = (output.file, &mut self.insertions);
        let output_context = output.context();
        let mut output_expressions: FxHashMap<(Shape, u32, u32), ExprId> = FxHashMap::default();
        for index in 0..output_file.exprs.len() {
            let expr = ExprId(index as u32);
            let (shape, key) = output.shape(expr);
            for (source, key) in [Some(key), output.name_of_dotted_index(expr)]
                .into_iter()
                .flatten()
                .filter_map(|key| mappings.original(key))
            {
                output_expressions
                    .entry((shape, source, key))
                    .or_insert(expr);
            }
        }
        let is_literal = |expr: ExprId| match output_file[expr].kind {
            ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::BigInt(_) => true,
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => matches!(
                output_file[operand].kind,
                ExprKind::Number(_) | ExprKind::BigInt(_)
            ),
            _ => false,
        };
        let mut output_places: FxHashMap<(Place, u32, u32), u32> = FxHashMap::default();
        for slot in output
            .slots()
            .iter()
            .filter(|slot| matches!(slot.place, Place::Binding | Place::MemberType))
        {
            if let Some((source, key)) = mappings.original(slot.key) {
                output_places
                    .entry((slot.place, source, key))
                    .or_insert(slot.start);
            }
        }
        let shorthand_values: FxHashSet<ExprId> = output_file
            .props
            .iter()
            .filter(|property| property.kind == PropKind::Shorthand)
            .map(|property| property.value)
            .collect();
        for (index, module) in written.iter().enumerate() {
            let Some(module) = module.as_ref().filter(|module| !module.is_unchecked()) else {
                continue;
            };
            let syntax = &module.syntax;
            let places = syntax.parent_links();
            let without_casts = |expr: ExprId| syntax.file.skip_type_assertions(expr);
            let default_exports = syntax
                .file
                .stmts
                .iter()
                .filter_map(|statement| match statement.kind {
                    StmtKind::ExportDefault(value) => Some((
                        value,
                        syntax.file.exprs.get(without_casts(value).idx())?.pos,
                    )),
                    _ => None,
                });
            let anchored: FxHashMap<ExprId, u32> = syntax
                .anchored_expressions()
                .map(|(key, value)| (value, key))
                .chain(default_exports)
                .collect();
            let find = |expr: ExprId| {
                let (shape, key) = syntax.shape(expr);
                [Some(key), syntax.name_of_dotted_index(expr)]
                    .into_iter()
                    .flatten()
                    .find_map(|key| output_expressions.get(&(shape, index as u32, key)).copied())
            };
            let find_via_ancestor = |chain: &CastChain| {
                let (mut at, mut way) = (chain.outermost, Vec::new());
                let mut found = loop {
                    if let Some(&found) = anchored
                        .get(&at)
                        .and_then(|&key| output_anchored.get(&(index as u32, key)))
                    {
                        break found;
                    }
                    let (parent, place) = places[at.idx()]?;
                    at = parent;
                    if syntax.file.type_assertion_operand(parent).is_some() {
                        continue;
                    }
                    way.push((parent, place));
                    if let Some(found) = find(parent) {
                        break found;
                    }
                };
                for (parent, place) in way.into_iter().rev() {
                    let children = output.children(found);
                    if std::mem::discriminant(&syntax.file[parent].kind)
                        != std::mem::discriminant(&output_file[found].kind)
                        || children.len() != syntax.children(parent).len()
                    {
                        return None;
                    }
                    found = children[place];
                }
                Some(found)
            };
            let file = syntax.file;
            let variables = file
                .var_decls
                .iter()
                .filter(|declaration| {
                    declaration.kind != VarKind::Const && declaration.ty.is_none()
                })
                .map(|declaration| {
                    (
                        declaration.init,
                        Place::Binding,
                        syntax.first_identifier(declaration.pat),
                    )
                });
            let parameters = file
                .params
                .iter()
                .filter(|parameter| parameter.ty.is_none())
                .map(|parameter| {
                    (
                        parameter.default,
                        Place::Binding,
                        syntax.first_identifier(parameter.pat),
                    )
                });
            let properties = file.members.iter().filter(|member| {
                member.kind == MemberKind::Property
                    && member.ty.is_none()
                    && !member.flags.contains(Flags::READONLY)
            });
            let properties = properties.map(|member| {
                (
                    member.init,
                    Place::MemberType,
                    Some(syntax.member_key(member)),
                )
            });
            let widened: FxHashMap<ExprId, (Place, u32)> = variables
                .chain(parameters)
                .chain(properties)
                .filter_map(|(initializer, place, key)| Some((initializer.some()?, (place, key?))))
                .collect();
            let enum_member_cast = |expr: ExprId| {
                let ExprKind::Dot { obj, .. } = syntax.file[expr].kind else {
                    return None;
                };
                let name_pos = syntax.file.name_pos(expr);
                let name = linked
                    .enum_names
                    .get(&(index as u32, syntax.file.exprs.get(obj.idx())?.pos))?;
                Some([&b" as "[..], name, b".", syntax.word(name_pos)].concat())
            };
            let mut chains = syntax.cast_chains();
            let operands: FxHashSet<ExprId> = chains.iter().map(|chain| chain.operand).collect();
            let members = (0..syntax.file.exprs.len() as u32)
                .map(ExprId)
                .filter(|&expr| !operands.contains(&expr) && enum_member_cast(expr).is_some());
            chains.extend(members.map(|expr| CastChain {
                operand: expr,
                outermost: expr,
                casts: Vec::new(),
            }));
            for chain in chains {
                if is_covered(
                    &module.type_ranges,
                    syntax.file[chain.operand].pos,
                    syntax.file[chain.operand].end,
                ) {
                    continue;
                }
                let source_position = syntax.file[chain.operand].pos;
                let found = find(chain.operand).or_else(|| find_via_ancestor(&chain));
                let Some(operand) = found.or_else(|| {
                    [Shape::Leaf, Shape::Prefix].iter().find_map(|&shape| {
                        output_expressions
                            .get(&(shape, index as u32, source_position))
                            .copied()
                            .filter(|&literal| is_literal(literal))
                    })
                }) else {
                    continue;
                };
                let member = enum_member_cast(chain.operand).filter(|_| is_literal(operand));
                if member.is_none() && chain.casts.is_empty() {
                    continue;
                }
                let own = output.parentheses(operand);
                if own.len() > 1
                    || (own.len() == 1)
                        != output.needs_parentheses(&output_context, operand, operand)
                {
                    self.dropped_casts += 1;
                    continue;
                }
                let (start, end) = output.outer_span(operand);
                let mut level = if own.is_empty() {
                    output.level(operand)
                } else {
                    Level::Member
                };
                let (mut opens, mut suffix) = (0usize, Vec::new());
                if let Some(member) = member {
                    suffix.extend_from_slice(&member);
                    level = Level::Compare;
                    let declared = widened
                        .get(&chain.outermost)
                        .and_then(|&(place, key)| output_places.get(&(place, index as u32, key)));
                    if let (Some(&declared), Some(name)) = (
                        declared,
                        linked.enum_names.get(&(index as u32, source_position)),
                    ) {
                        insertions.add(declared, Order::Slot, [&b": "[..], name].concat());
                    }
                }
                for &cast in &chain.casts {
                    if level.lt(syntax.level_required_by_cast(cast)) {
                        opens += 1;
                        suffix.push(b')');
                    }
                    let text_of = |node: TypeNodeId| {
                        let (start, end) = syntax.type_span(node);
                        module.text(start, end)
                    };
                    match syntax.file[cast].kind {
                        ExprKind::As { ty, .. } => {
                            suffix.extend_from_slice(&[&b" as "[..], &text_of(ty)].concat())
                        }
                        ExprKind::Satisfies { ty, .. } => {
                            suffix.extend_from_slice(&[&b" satisfies "[..], &text_of(ty)].concat())
                        }
                        ExprKind::AsConst(_)
                            if matches!(output_file[operand].kind, ExprKind::Unary { .. })
                                && matches!(
                                    syntax.file[chain.operand].kind,
                                    ExprKind::True | ExprKind::False
                                ) =>
                        {
                            let literal = syntax.word(syntax.file[chain.operand].pos);
                            suffix.extend_from_slice(&[b" as ", literal].concat())
                        }
                        ExprKind::AsConst(_) => suffix.extend_from_slice(b" as const"),
                        ExprKind::NonNull(_) => suffix.push(b'!'),
                        ExprKind::Instantiation { type_args, .. } => {
                            if let Some((start, end)) =
                                syntax.type_arguments_span(syntax.file.list_at(type_args))
                            {
                                suffix.extend_from_slice(&module.text(start, end));
                            }
                        }
                        _ => {}
                    }
                    level = syntax.level(cast);
                }
                let is_loose = level == Level::Compare
                    && (output_context.is_before_operator[operand.idx()]
                        || output.next_token_extends_type(end));
                if level.lt(output_context.required[operand.idx()]) || is_loose {
                    opens += 1;
                    suffix.push(b')');
                }
                if shorthand_values.contains(&operand) {
                    if opens > 0 {
                        self.dropped_casts += 1;
                        continue;
                    }
                    insertions.add(
                        start,
                        Order::MemberName,
                        [output.word(start), b": "].concat(),
                    );
                }
                insertions.add(
                    start,
                    Order::Open(u32::MAX - (end - start)),
                    vec![b'('; opens],
                );
                insertions.add(end, Order::Close(end - start), suffix);
            }
        }
    }

    fn type_enum_and_namespace_objects(&mut self) {
        let (output, mappings, linked) = (self.output, self.mappings, self.linked);
        let (output_file, insertions) = (output.file, &mut self.insertions);
        for expr in output_file.exprs.iter() {
            let ExprKind::Assign { target, value, .. } = expr.kind else {
                continue;
            };
            let is_enum_object = mappings
                .original(output_file[target].pos)
                .is_some_and(|original| linked.emitted_enums.contains_key(&original));
            if is_enum_object
                && matches!(output_file[value].kind, ExprKind::Object(properties) if properties.is_empty())
            {
                insertions.add(output_file[value].end, Order::Slot, b" as any".to_vec());
            }
        }
        for (id, expr) in output_file.exprs.iter().enumerate() {
            let ExprKind::Dot { obj, .. } = expr.kind else {
                continue;
            };
            let name_pos = output_file.name_pos(ExprId(id as u32));
            let is_require_of_bun = matches!(output_file[obj].kind, ExprKind::ImportMeta)
                && output.word(name_pos) == b"require";
            let is_require_applied = matches!(output_file[obj].kind, ExprKind::Ident(_))
                && output.word(output_file[obj].pos) == b"require"
                && output.word(name_pos) == b"apply";
            if (is_require_of_bun || is_require_applied) && output.parentheses(obj).is_empty() {
                insertions.add(output_file[obj].pos, Order::Open(0), b"(".to_vec());
                insertions.add(output_file[obj].end, Order::Close(0), b" as any)".to_vec());
            }
        }
        for object in output.namespace_objects() {
            insertions.add(
                output_file[object.variable.pat].end,
                Order::Slot,
                b": any".to_vec(),
            );
        }
    }

    fn copy_statements(&mut self) {
        let (javascript, output, mappings, written, linked) = (
            self.javascript,
            self.output,
            self.mappings,
            self.modules,
            self.linked,
        );
        let (output_file, insertions) = (output.file, &mut self.insertions);
        let mut ambient_values: FxHashSet<&[u8]> = FxHashSet::default();
        let output_identifiers: FxHashSet<&[u8]> =
            output.used_names().map(|at| output.word(at)).collect();
        let mut output_statements: FxHashMap<(u32, u32), u32> = FxHashMap::default();
        for (id, statement) in output_file.stmts.iter().enumerate() {
            for key in [statement.start, output.after_modifiers(StmtId(id as u32))] {
                if let Some(original) = mappings.original(key) {
                    output_statements.entry(original).or_insert(statement.start);
                }
            }
        }
        let top_level: Vec<u32> = output_file
            .ids(output_file.body)
            .map(|id| output_file[id].start)
            .collect();
        for (index, module) in written.iter().enumerate() {
            let Some(module) = module else { continue };
            let (syntax, file) = (&module.syntax, module.syntax.file);
            for (depth, list) in syntax.statement_lists().into_iter().enumerate() {
                let statements: Vec<StmtId> = file.ids(list).collect();
                for (place, &id) in statements.iter().enumerate() {
                    let statement = &file[id];
                    let anchor_of = |next_id: StmtId| {
                        let next = &file[next_id];
                        let first_name = match next.kind {
                            StmtKind::Var(declarations) => declarations
                                .iter()
                                .next()
                                .map(|declaration: VarDeclId| file[file[declaration].pat].pos),
                            _ => None,
                        };
                        [
                            Some(next.start),
                            Some(syntax.after_modifiers(next_id)),
                            first_name,
                        ]
                        .iter()
                        .flatten()
                        .find_map(|&key| output_statements.get(&(index as u32, key)).copied())
                    };
                    let text: Vec<u8> = match statement.kind {
                        StmtKind::Import(_)
                        | StmtKind::ExportNamed(_)
                        | StmtKind::ExportStar { .. } => continue,
                        StmtKind::Enum(enum_statement)
                            if linked.ambient_enums.contains(&(index, id.0)) =>
                        {
                            let is_emitted = linked
                                .emitted_enums
                                .contains_key(&(index as u32, file[enum_statement].name_pos));
                            let dropped_modifiers = if is_emitted {
                                Flags::EXPORT | Flags::DEFAULT | Flags::CONST
                            } else {
                                Flags::EXPORT | Flags::DEFAULT
                            };
                            [
                                &b"declare "[..],
                                &module.statement_text(id, dropped_modifiers),
                            ]
                            .concat()
                        }
                        StmtKind::Var(declarations)
                            if depth == 0 && syntax.is_type_only_statement(id) =>
                        {
                            let mut names = Vec::new();
                            declarations.iter().for_each(|declaration: VarDeclId| {
                                syntax.identifiers(file[declaration].pat, &mut names)
                            });
                            let is_referenced = |name: &[u8]| {
                                output_identifiers.contains(name)
                                    || module.types.is_none_or(|types| {
                                        self.type_references.contains(&(&types.path[..], name))
                                    })
                            };
                            let mut is_new = false;
                            for name in names.iter().map(|&name| syntax.word(name)) {
                                is_new |= is_referenced(name) && ambient_values.insert(name);
                            }
                            if !is_new {
                                continue;
                            }
                            module.statement_text(id, Flags::EXPORT | Flags::DEFAULT)
                        }
                        StmtKind::Fn(_) if linked.ambient_signatures.contains(&(index, id.0)) => {
                            continue;
                        }
                        _ if linked.replaced_statements.contains(&(index, id.0)) => continue,
                        StmtKind::Module(_)
                            if depth == 0
                                && module.merged_augmentation_text(statement).is_some() =>
                        {
                            module
                                .merged_augmentation_text(statement)
                                .unwrap_or_default()
                        }
                        StmtKind::Module(_) if depth > 0 => continue,
                        StmtKind::Module(_) if !syntax.is_type_only_statement(id) => {
                            match module.types_of_namespace(id, Flags::EXPORT) {
                                Some(types) => types,
                                None => continue,
                            }
                        }
                        _ if syntax.is_type_only_statement(id) => {
                            module.statement_text(id, Flags::EXPORT | Flags::DEFAULT)
                        }
                        _ => continue,
                    };
                    let is_ignored = file
                        .comment_directives
                        .iter()
                        .any(|directive| syntax.after_trivia(directive.end) == statement.start);
                    let text = if is_ignored {
                        [&b"// @ts-ignore\n"[..], &text].concat()
                    } else {
                        text
                    };
                    let next = statements[place..].iter().copied().find_map(anchor_of);
                    let next = next.map(|next| {
                        if depth == 0 {
                            top_level[top_level
                                .partition_point(|&start| start <= next)
                                .saturating_sub(1)]
                        } else {
                            next
                        }
                    });
                    let is_signature = matches!(statement.kind, StmtKind::Fn(function) if matches!(file[function].body, FnBody::None))
                        && !file
                            .modifiers_to_flags(file.stmt_modifiers(id))
                            .contains(Flags::AMBIENT);
                    match next {
                        Some(next) if is_signature => {
                            insertions.add_line_in_order(javascript, next, Order::Signature, &text)
                        }
                        Some(next) => insertions.add_line_before(javascript, next, &text),
                        None if depth == 0 => {
                            self.hoisted.extend_from_slice(&[&text[..], b"\n"].concat())
                        }
                        None => {}
                    }
                }
            }
        }
    }

    fn copy_directives(&mut self) {
        let (javascript, mappings, written, insertions) = (
            self.javascript,
            self.mappings,
            self.modules,
            &mut self.insertions,
        );
        let mut by_original: Vec<(u32, u32, u32)> = mappings
            .entries
            .iter()
            .map(|&(generated, source, original)| (source, original, generated))
            .collect();
        by_original.sort_unstable();
        let mut ignored: Vec<usize> = Vec::new();
        let templates: Vec<(usize, usize)> = (self.output.file.exprs.iter())
            .filter(|expr| javascript.get(expr.pos as usize) == Some(&b'`'))
            .map(|expr| (expr.pos as usize, expr.end as usize))
            .collect();
        for (index, module) in written.iter().enumerate() {
            let Some(module) = module else { continue };
            for directive in module
                .syntax
                .file
                .comment_directives
                .iter()
                .filter(|directive| !is_inside(&module.type_ranges, directive.start))
            {
                let next = module.syntax.after_trivia(directive.end);
                if is_inside(&module.declarations, next) {
                    continue;
                }
                let from =
                    by_original.partition_point(|entry| (entry.0, entry.1) < (index as u32, next));
                let text = module.syntax.text;
                let end_of_line =
                    bun_core::strings::index_of_char_usize(&text[next as usize..], b'\n')
                        .map_or(text.len(), |length| next as usize + length)
                        as u32;
                let is_at_a_token = |entry: &&(u32, u32, u32)| {
                    !javascript
                        .get(entry.2 as usize)
                        .is_some_and(u8::is_ascii_whitespace)
                };
                let on_the_line = by_original[from..]
                    .iter()
                    .take_while(|entry| entry.0 == index as u32 && entry.1 < end_of_line)
                    .filter(is_at_a_token);
                ignored.extend(
                    on_the_line
                        .chain(
                            by_original
                                .get(from)
                                .filter(|entry| entry.0 == index as u32),
                        )
                        .map(|entry| line_start(javascript, entry.2 as usize)),
                );
            }
            let file = module.syntax.file;
            let returned: FxHashSet<u32> = file.stmts.iter().filter(|statement| matches!(statement.kind, StmtKind::Return(value) if value.is_some())).map(|statement| statement.start).collect();
            let returns_nothing = self.output.file.stmts.iter().filter(
                |statement| matches!(statement.kind, StmtKind::Return(value) if value.is_none()),
            );
            ignored.extend(
                returns_nothing
                    .filter(|statement| {
                        mappings.original(statement.start).is_some_and(|original| {
                            original.0 == index as u32 && returned.contains(&original.1)
                        })
                    })
                    .map(|statement| line_start(javascript, statement.start as usize)),
            );
        }
        let is_unchecked = |source: u32| {
            written
                .get(source as usize)
                .is_some_and(|module| module.as_ref().is_none_or(Written::is_unchecked))
        };
        ignored.extend(
            mappings
                .entries
                .iter()
                .filter(|entry| is_unchecked(entry.1))
                .map(|entry| line_start(javascript, entry.0 as usize)),
        );
        let output_file = self.output.file;
        for statement in output_file
            .ids(output_file.body)
            .map(|id| &output_file[id])
            .filter(|statement| matches!(statement.kind, StmtKind::Fn(_)))
        {
            let (start, end) = (statement.start, statement.loc.end);
            let first_inside = mappings
                .entries
                .get(mappings.entries.partition_point(|entry| entry.0 < start));
            if first_inside.is_some_and(|entry| entry.0 < end) {
                continue;
            }
            let mut line = line_start(javascript, start as usize);
            while line < end as usize {
                ignored.push(line);
                line = bun_core::strings::index_of_char_usize(&javascript[line..], b'\n')
                    .map_or(javascript.len(), |length| line + length + 1);
            }
        }
        ignored.sort_unstable();
        ignored.dedup();
        for line in ignored {
            let indent = javascript[line..]
                .iter()
                .take_while(|byte| matches!(byte, b' ' | b'\t'))
                .count();
            match templates
                .iter()
                .filter(|template| template.0 < line && line < template.1)
                .min()
            {
                None => {
                    insertions.add_line_in_order(
                        javascript,
                        (line + indent) as u32,
                        Order::Directive,
                        b"// @ts-ignore",
                    );
                    let end = bun_core::strings::index_of_char_usize(&javascript[line..], b'\n')
                        .map_or(javascript.len(), |length| line + length);
                    insertions.ignore_after_line_breaks((line + indent) as u32, end as u32);
                }
                Some(&(start, _)) if line_start(javascript, line - 1) <= start => {
                    insertions.add(start as u32, Order::Directive, b"/* @ts-ignore */".to_vec())
                }
                Some(_) => {}
            }
        }
    }

    fn copy_members(&mut self) {
        let (javascript, output, mappings, written) =
            (self.javascript, self.output, self.mappings, self.modules);
        let (output_file, insertions) = (output.file, &mut self.insertions);
        let mut output_members: FxHashMap<(u32, u32), u32> = FxHashMap::default();
        let mut output_classes: FxHashMap<(u32, u32), u32> = FxHashMap::default();
        let mut class_ends: FxHashMap<u32, u32> = FxHashMap::default();
        for statement in output_file.stmts.iter() {
            if let StmtKind::Class(class) = statement.kind {
                class_ends.insert(class.0, statement.loc.end);
            }
        }
        for expr in output_file.exprs.iter() {
            if let ExprKind::Class(class) = expr.kind {
                class_ends.insert(class.0, expr.end);
            }
        }
        for (index, class) in output_file.classes.iter().enumerate() {
            if let (Some(original), Some(&end)) = (
                mappings.original(output.class_body_pos(class)),
                class_ends.get(&(index as u32)),
            ) {
                output_classes.insert(original, end - 1);
            }
            for member in class.members.iter().map(|member| &output_file[member]) {
                let key = output.member_key(member);
                let space_before = key
                    .checked_sub(1)
                    .filter(|&before| javascript.get(before as usize) == Some(&b' '));
                if let Some(original) = mappings
                    .original(key)
                    .or_else(|| mappings.original(space_before?))
                {
                    output_members.entry(original).or_insert(member.start);
                }
            }
        }
        for (index, module) in written.iter().enumerate() {
            let Some(module) = module else { continue };
            let (syntax, file) = (&module.syntax, module.syntax.file);
            for class in file.classes.iter() {
                let Some(&close) =
                    output_classes.get(&(index as u32, syntax.class_body_pos(class)))
                else {
                    continue;
                };
                let members: Vec<&Member> =
                    class.members.iter().map(|member| &file[member]).collect();
                let mut add = |place: usize, text: &[u8]| {
                    let next = members[place..].iter().find_map(|next| {
                        output_members
                            .get(&(index as u32, syntax.member_key(next)))
                            .copied()
                    });
                    let before =
                        &javascript[line_start(javascript, close as usize)..close as usize];
                    let is_terminated =
                        is_blank(before) || matches!(before.last(), Some(b'{' | b';'));
                    match next {
                        Some(next) => insertions.add_line_before(javascript, next, text),
                        None if is_terminated => {
                            insertions.add_line_before(javascript, close, text)
                        }
                        None => {
                            insertions.add_line_before(javascript, close, &[b";", text].concat())
                        }
                    }
                };
                for (place, member) in members.iter().enumerate() {
                    if syntax.is_type_only_member(member) {
                        add(place, &module.text(member.start, member.loc.end));
                    } else if member.kind == MemberKind::Property
                        && !output_members.contains_key(&(index as u32, syntax.member_key(member)))
                        && member.ty.is_some()
                    {
                        add(
                            place,
                            &[
                                &b"declare "[..],
                                &module.text(member.start, syntax.type_span(member.ty).1),
                                b";",
                            ]
                            .concat(),
                        );
                    }
                    let Some(constructor) = member
                        .func
                        .some()
                        .filter(|_| member.kind == MemberKind::Constructor)
                    else {
                        continue;
                    };
                    for parameter in file[constructor]
                        .params
                        .iter()
                        .map(|parameter| &file[parameter])
                        .filter(|parameter| parameter.flags.contains(Flags::PARAMETER_PROPERTY))
                    {
                        let Some(binding) = syntax.binding_slot(
                            parameter.pat,
                            parameter.ty,
                            parameter.flags.contains(Flags::OPTIONAL),
                        ) else {
                            continue;
                        };
                        if !output_members.contains_key(&(index as u32, binding.key)) {
                            add(
                                0,
                                &[
                                    &b"declare "[..],
                                    &module.text(parameter.pos, binding.end),
                                    b";",
                                ]
                                .concat(),
                            );
                        }
                    }
                }
            }
        }
    }

    fn finish(mut self) -> Result<TypedText, String> {
        let (javascript, output, output_file) = (self.javascript, self.output, self.output.file);
        self.hoisted.extend_from_slice(&self.linked.hoisted);
        let is_directive = |statement: &Stmt| matches!(statement.kind, StmtKind::Expr(expr) if matches!(output_file[expr].kind, ExprKind::String(_)) && output.parentheses(expr).is_empty());
        let first = output_file
            .ids(output_file.body)
            .map(|id| &output_file[id])
            .find(|statement| !is_directive(statement));
        if let Some(first) = first {
            self.insertions
                .add(first.start, Order::Line, std::mem::take(&mut self.hoisted));
        }
        let mut text = self.insertions.apply(javascript);
        if !self.hoisted.is_empty() && !text.is_empty() && !text.ends_with(b"\n") {
            return Err("the JavaScript does not end with a line break".into());
        }
        text.extend_from_slice(&self.hoisted);
        let has_default_export = output.has_default_export();
        Ok(TypedText {
            text,
            dropped_casts: self.dropped_casts,
            has_default_export,
            modules_of_untyped_values: self.linked.modules_of_untyped_values.clone(),
            source: None,
        })
    }
}

const TYPED_EXTENSIONS: [(&[u8], &[u8]); 3] = [
    (b".js", b".aot.ts"),
    (b".mjs", b".aot.mts"),
    (b".cjs", b".aot.cts"),
];

/// `index.aot.ts` for `index.js`.
pub fn typed_path_beside(javascript: &[u8]) -> Option<Vec<u8>> {
    TYPED_EXTENSIONS
        .iter()
        .find_map(|(from, to)| Some([javascript.strip_suffix(*from)?, *to].concat()))
}

/// `index.js` for `index.aot.ts`.
pub fn javascript_path_beside(typed: &[u8]) -> Option<Vec<u8>> {
    TYPED_EXTENSIONS
        .iter()
        .find_map(|(to, from)| Some([typed.strip_suffix(*from)?, *to].concat()))
}

fn ancestors(path: &[u8]) -> impl Iterator<Item = &[u8]> {
    std::iter::successors(Some(path), |path| {
        let at = path
            .iter()
            .rposition(|&byte| byte == b'/' || cfg!(windows) && byte == b'\\')?;
        (at > 0).then(|| &path[..at])
    })
}

fn absolute(directory: &[u8], path: &[u8]) -> Vec<u8> {
    if cfg!(windows) && bun_paths::is_fully_qualified(path) {
        return crate::host::from_native(path);
    }
    let mut parts: Vec<&[u8]> = if path.starts_with(b"/") {
        Vec::new()
    } else {
        bun_core::strings::split(directory, b"/")
            .filter(|part| !part.is_empty())
            .collect()
    };
    for part in bun_core::strings::split(path, b"/") {
        match part {
            b"" | b"." => {}
            b".." => drop(parts.pop()),
            _ => parts.push(part),
        }
    }
    [&b"/"[..], &parts.join(&b"/"[..])].concat()
}

fn add_types_by_source_map(
    path: &[u8],
    javascript: &[u8],
    source_map: &[u8],
    bundle: &Bundle<'_>,
) -> Result<TypedText, String> {
    let source_map = crate::host::parse_json_object(&bun_sema::session::Arena::new(), source_map)
        .ok_or("the source map is not JSON")?;
    let strings = |field: &[u8]| -> Vec<&[u8]> {
        source_map
            .get(field)
            .and_then(Json::as_array)
            .unwrap_or_default()
            .iter()
            .map(|entry| entry.as_str().unwrap_or_default())
            .collect()
    };
    let (paths, texts) = (strings(b"sources"), strings(b"sourcesContent"));
    if paths.len() != texts.len() {
        return Err("the source map does not hold the text of its sources".into());
    }
    let directory = &path[..bun_core::strings::last_index_of_char(path, b'/').unwrap_or(0)];
    let is_known = |path: &Vec<u8>| {
        bundle
            .modules
            .iter()
            .any(|module| module.path[..] == path[..])
    };
    let paths: Vec<Vec<u8>> = (paths.iter())
        .map(|source| {
            ancestors(directory)
                .map(|from| absolute(from, source))
                .find(is_known)
                .unwrap_or_else(|| absolute(directory, source))
        })
        .collect();
    let sources: Vec<Source<'_>> = paths
        .iter()
        .zip(&texts)
        .map(|(path, &text)| Source { path, text })
        .collect();
    let mappings = source_map
        .get(b"mappings")
        .and_then(Json::as_str)
        .ok_or("the source map has no mappings")?;
    let typed = add_types(path, javascript, mappings, &sources, bundle)?;
    Ok(TypedText {
        source: paths.first().filter(|path| is_known(path)).cloned(),
        ..typed
    })
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum Target {
    Declaration { path: Box<[u8]>, name: Box<[u8]> },
    Module { path: Box<[u8]> },
}

pub struct ModuleTypes {
    pub path: Box<[u8]>,
    pub text: Box<[u8]>,
    pub references: Vec<(u32, Target)>,
    pub enum_objects: Vec<u32>,
    pub exports: Vec<(Box<[u8]>, Target)>,
    pub constants: Vec<(u32, Box<[u8]>)>,
    pub functions_returning_undefined: Vec<u32>,
    pub globals: Vec<u32>,
    pub augmented_modules: Vec<(u32, Box<[u8]>)>,
    pub locals: Vec<(u32, u32)>,
    pub emitted_declarations: Box<[u8]>,
}

impl ModuleTypes {
    fn constant_type(&self, binding: u32) -> Option<&[u8]> {
        self.constants
            .iter()
            .find(|constant| constant.0 == binding)
            .map(|constant| &constant.1[..])
    }
}

fn is_project_source(checker: &Checker<'_, '_>, file: FileId) -> bool {
    let module = checker.p.files.module(file);
    (matches!(module.hir.kind, FileKind::Ts | FileKind::Tsx)
        || module.hir.kind == FileKind::Declaration && !module.is_lib && module.is_module())
        && !module.hir.is_js
        && !module.is_from_external_library
}

fn target_of(
    services: &mut Services<'_, '_, '_>,
    is_source: &dyn Fn(FileId) -> Option<Box<[u8]>>,
    symbol: SymbolRef,
) -> Option<Target> {
    let aliased = services.symbol_op(SymbolOp::Aliased, symbol);
    let behind = aliased
        .filter(|&aliased| is_alias_merged_with_type(services, aliased))
        .and_then(|aliased| services.symbol_op(SymbolOp::Aliased, aliased));
    [behind, aliased, Some(symbol)]
        .into_iter()
        .flatten()
        .find_map(|symbol| target_declared_by(services, is_source, symbol))
}

fn is_alias_merged_with_type(services: &mut Services<'_, '_, '_>, symbol: SymbolRef) -> bool {
    let flags = services.symbol_info(symbol).flags;
    flags.contains(SymbolFlags::ALIAS) && flags.intersects(SymbolFlags::TYPE)
}

fn alias_merged_with_type(
    services: &mut Services<'_, '_, '_>,
    symbol: SymbolRef,
) -> Option<SymbolRef> {
    let aliased = services.symbol_op(SymbolOp::Aliased, symbol);
    [Some(symbol), aliased]
        .into_iter()
        .flatten()
        .find(|&symbol| is_alias_merged_with_type(services, symbol))
}

fn target_declared_by(
    services: &mut Services<'_, '_, '_>,
    is_source: &dyn Fn(FileId) -> Option<Box<[u8]>>,
    symbol: SymbolRef,
) -> Option<Target> {
    let declarations = services.declarations(symbol).to_vec();
    declarations
        .into_iter()
        .find_map(|declaration| target_of_declaration(services, is_source, declaration))
}

fn target_of_declaration(
    services: &mut Services<'_, '_, '_>,
    is_source: &dyn Fn(FileId) -> Option<Box<[u8]>>,
    declaration: NodeRef,
) -> Option<Target> {
    let path = is_source(declaration.file)?;
    if declaration.node == Node::FILE {
        return Some(Target::Module { path });
    }
    let mut node = declaration.node;
    loop {
        let parent = services.node_parent(NodeRef {
            file: declaration.file,
            node,
        });
        if parent == Node::FILE {
            break;
        }
        match services.node_kind(NodeRef {
            file: declaration.file,
            node: parent,
        }) {
            Kind::VariableDeclarationList
            | Kind::VariableStatement
            | Kind::VariableDeclaration
            | Kind::BindingElement
            | Kind::ObjectBindingPattern
            | Kind::ArrayBindingPattern => node = parent,
            Kind::NamedImports | Kind::ImportClause | Kind::ImportDeclaration => node = parent,
            _ => return None,
        }
    }
    if services.node_kind(declaration) == Kind::ExportAssignment {
        return Some(Target::Declaration {
            path,
            name: b"default"[..].into(),
        });
    }
    let name = services.node_child(declaration, Child::Name);
    let name = services.node_text(NodeRef {
        file: declaration.file,
        node: name,
    });
    (!name.is_empty()).then(|| Target::Declaration {
        path,
        name: name.into(),
    })
}

pub fn module_types(checker: &mut Checker<'_, '_>, file: FileId) -> Option<ModuleTypes> {
    if !is_project_source(checker, file) {
        return None;
    }
    let count = checker.p.files.modules.len();
    let paths: Vec<Option<Box<[u8]>>> = (0..count as u32)
        .map(|other| {
            is_project_source(checker, FileId(other))
                .then(|| checker.p.files.module(FileId(other)).file_name().into())
        })
        .collect();
    let is_source = |file: FileId| paths.get(file.idx()).cloned().flatten();
    let hir = checker.hir(file);
    let type_ranges = Syntax {
        file: hir,
        text: &hir.text[..],
    }
    .type_ranges();
    let path = paths[file.idx()].clone()?;
    Some(checker.with_services(file, None, |services| {
        let mut references = Vec::new();
        let mut globals = Vec::new();
        let mut locals = Vec::new();
        let mut note = |services: &mut Services<'_, '_, '_>,
                        at: u32,
                        symbol: SymbolRef,
                        is_head: bool,
                        is_own_type: bool| match if is_own_type {
            target_declared_by(services, &is_source, symbol)
        } else {
            target_of(services, &is_source, symbol)
        } {
            Some(target) => references.push((at, target)),
            None if is_head => match services.declarations(symbol).first().copied() {
                Some(declaration) if is_source(declaration.file).is_none() => globals.push(at),
                Some(declaration) if declaration.file == file => {
                    let name = services.node_child(declaration, Child::Name);
                    locals.push((at, services.node_span(NodeRef { file, node: name }).0));
                }
                _ => {}
            },
            None => {}
        };
        for (index, name) in hir.names.iter().enumerate() {
            let node = NodeRef {
                file,
                node: hir.node(NameId(index as u32)),
            };
            let Some(symbol) = services.symbol_at_location(node) else {
                continue;
            };
            let is_whole_name = !name.is_qualified()
                && !hir
                    .names
                    .get(index + 1)
                    .is_some_and(|next| next.is_qualified());
            let merged = alias_merged_with_type(services, symbol).filter(|_| is_whole_name);
            note(
                services,
                name.pos(),
                merged.unwrap_or(symbol),
                !name.is_qualified(),
                merged.is_some(),
            );
        }
        for (index, expr) in hir
            .exprs
            .iter()
            .enumerate()
            .filter(|(_, expr)| is_inside(&type_ranges, expr.pos))
        {
            let at = match expr.kind {
                ExprKind::Ident(_) => expr.pos,
                ExprKind::Dot { .. } => hir.name_pos(ExprId(index as u32)),
                _ => continue,
            };
            if let Some(symbol) = services.symbol_at_location(NodeRef {
                file,
                node: hir.node(ExprId(index as u32)),
            }) {
                note(
                    services,
                    at,
                    symbol,
                    matches!(expr.kind, ExprKind::Ident(_)),
                    false,
                );
            }
        }
        let mut enum_objects = Vec::new();
        for expr in hir.exprs.iter() {
            let ExprKind::Dot { obj, .. } = expr.kind else {
                continue;
            };
            let Some(object) = hir
                .exprs
                .get(obj.idx())
                .filter(|object| matches!(object.kind, ExprKind::Ident(_)))
            else {
                continue;
            };
            let Some(symbol) = services.symbol_at_location(NodeRef {
                file,
                node: hir.node(obj),
            }) else {
                continue;
            };
            let aliased = services
                .symbol_op(SymbolOp::Aliased, symbol)
                .unwrap_or(symbol);
            if services
                .symbol_info(aliased)
                .flags
                .intersects(SymbolFlags::ENUM)
                && let Some(target) = target_of(services, &is_source, symbol)
            {
                references.push((object.pos, target));
                enum_objects.push(object.pos);
            }
        }
        let mut exports = Vec::new();
        if let Some(module) = services.symbol_at_location(NodeRef {
            file,
            node: Node::FILE,
        }) {
            for &exported in services.symbol_table(SymbolTable::ExportsOfModule, module) {
                let name: Box<[u8]> = services.symbol_info(exported).name.into();
                let value = target_of(services, &is_source, exported);
                let merged = alias_merged_with_type(services, exported)
                    .and_then(|merged| target_declared_by(services, &is_source, merged))
                    .filter(|merged| value.as_ref() != Some(merged));
                exports.extend(
                    merged
                        .into_iter()
                        .chain(value)
                        .map(|target| (name.clone(), target)),
                );
            }
        }
        let mut constants = Vec::new();
        let lists = hir.ids(hir.body).filter_map(|id| match hir[id].kind {
            StmtKind::Var(declarations) => Some(declarations),
            _ => None,
        });
        for id in lists.flat_map(|declarations| declarations.iter()) {
            let id: VarDeclId = id;
            let declaration = &hir[id];
            if declaration.kind != VarKind::Const
                || declaration.ty.is_some()
                || declaration.flags.contains(Flags::AMBIENT)
                || !matches!(hir[declaration.pat].kind, PatKind::Ident(_))
            {
                continue;
            }
            let ty = services.type_at_location(NodeRef {
                file,
                node: hir.node(id),
            });
            let flags = services.type_flags(ty);
            let names_nothing = TypeFlags::STRING_LITERAL
                | TypeFlags::NUMBER_LITERAL
                | TypeFlags::BIG_INT_LITERAL
                | TypeFlags::INTRINSIC;
            if flags.contains(TypeFlags::UNIQUE_ES_SYMBOL) {
                constants.push((hir[declaration.pat].pos, b"unique symbol"[..].into()));
            } else if flags.intersects(names_nothing) && !flags.contains(TypeFlags::ENUM_LITERAL) {
                constants.push((
                    hir[declaration.pat].pos,
                    services
                        .type_to_string(
                            ty,
                            None,
                            TypeFormatFlags::DEFAULT | TypeFormatFlags::NO_TRUNCATION,
                        )
                        .into(),
                ));
            }
        }
        let mut functions_returning_undefined = Vec::new();
        for (index, function) in hir
            .fns
            .iter()
            .enumerate()
            .filter(|(_, function)| function.ret.is_none() && Syntax::has_javascript(function))
        {
            let signature = services.signature_from_declaration(NodeRef {
                file,
                node: hir.node(FnId(index as u32)),
            });
            if signature.is_some_and(|signature| {
                services.return_type_of_signature(signature) == TypeId::UNDEFINED
            }) {
                functions_returning_undefined.push(Syntax::function_key(function));
            }
        }
        let syntax = Syntax {
            file: hir,
            text: &hir.text[..],
        };
        let mut augmented_modules = Vec::new();
        for statement in hir.ids(hir.body).map(|id| &hir[id]) {
            let StmtKind::Module(declared) = statement.kind else {
                continue;
            };
            if let ModuleName::String(_) = hir[declared].name
                && let [_, specifier @ .., _] = syntax.word(hir[declared].name_pos)
                && let Some(path) = services.resolve_module_name(specifier).and_then(&is_source)
            {
                augmented_modules.push((statement.start, path));
            }
        }
        ModuleTypes {
            path,
            text: hir.text[..].into(),
            references,
            enum_objects,
            exports,
            constants,
            functions_returning_undefined,
            globals,
            augmented_modules,
            locals,
            emitted_declarations: Box::default(),
        }
    }))
}

pub struct Output<'a> {
    pub path: &'a [u8],
    pub javascript: &'a [u8],
    pub source_map: &'a [u8],
    pub entry_point: Option<&'a [u8]>,
}

pub struct SoundFiles {
    pub modules_of_untyped_values: Vec<Vec<u8>>,
    pub typed: Vec<(Vec<u8>, Vec<u8>)>,
    pub declarations_while_checked: Vec<(Vec<u8>, Vec<u8>)>,
    pub dropped_casts: usize,
}

fn inside<'a>(directory: &[u8], path: &'a [u8]) -> Option<&'a [u8]> {
    path.strip_prefix(directory)?.strip_prefix(b"/")
}

fn emitted_declarations_path(source: &[u8]) -> Option<Vec<u8>> {
    const EXTENSIONS: [(&[u8], &[u8]); 7] = [
        (b".d.ts", b""),
        (b".d.mts", b""),
        (b".d.cts", b""),
        (b".ts", b".d.ts"),
        (b".tsx", b".d.ts"),
        (b".mts", b".d.mts"),
        (b".cts", b".d.cts"),
    ];
    let (from, to) = EXTENSIONS.iter().find(|(from, _)| source.ends_with(from))?;
    (!to.is_empty()).then(|| [&source[..source.len() - from.len()], *to].concat())
}

pub fn tsconfig_of_sources(outputs: &[Output<'_>], modules: &[ModuleTypes]) -> Option<Vec<u8>> {
    let source = outputs
        .iter()
        .find_map(|output| output.entry_point)
        .or_else(|| modules.first().map(|module| &module.path[..]))?;
    tsconfig_of_package(source)
}

pub fn tsconfig_of_package(source: &[u8]) -> Option<Vec<u8>> {
    let disk = crate::host::Disk::with_already_read(1, Default::default(), source);
    let found = find_config_of_package(&disk, ancestors(source).nth(1)?)?;
    Some(crate::host::to_native(&found).to_vec())
}

pub fn emitted_declarations_of(
    modules: &[ModuleTypes],
    sources: &[Vec<u8>],
) -> Vec<(Vec<u8>, Vec<u8>)> {
    let wanted = modules.iter().filter(|module| {
        !module.emitted_declarations.is_empty()
            && sources.iter().any(|source| source[..] == module.path[..])
    });
    wanted
        .filter_map(|module| {
            Some((
                emitted_declarations_path(&module.path)?,
                module.emitted_declarations.to_vec(),
            ))
        })
        .collect()
}

fn typed_outputs(
    outdir: &[u8],
    outputs: &[Output<'_>],
    modules: &[ModuleTypes],
    emitted_declarations: &[ModuleTypes],
) -> Result<Vec<(Vec<u8>, TypedText)>, String> {
    let outdir = outdir.strip_suffix(b"/").unwrap_or(outdir);
    let mut found = Vec::new();
    for output in outputs {
        let shown = BStr::new(inside(outdir, output.path).unwrap_or(output.path));
        let bundle = Bundle {
            modules,
            emitted_declarations,
            entry_point: output.entry_point,
        };
        let typed =
            add_types_by_source_map(output.path, output.javascript, output.source_map, &bundle)
                .map_err(|why| format!("{shown}: {why}"))?;
        let typed_path = typed_path_beside(output.path)
            .ok_or_else(|| format!("{shown} is not named .js, .mjs or .cjs"))?;
        found.push((typed_path, typed));
    }
    for (typed_path, typed) in &mut found {
        typed.text = import_typed_outputs(typed_path, &typed.text, outputs)?;
    }
    Ok(found)
}

/// Rewrites `./chunk.js` to `./chunk.aot.ts` where `chunk.js` is one of `outputs`.
fn import_typed_outputs(
    typed_path: &[u8],
    text: &[u8],
    outputs: &[Output<'_>],
) -> Result<Vec<u8>, String> {
    if outputs.len() < 2 {
        return Ok(text.to_vec());
    }
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let file = parse(&session, &atoms, typed_path, text)?;
    let directory = ancestors(typed_path).nth(1).unwrap_or(b"/");
    let mut replacements: Vec<(usize, usize, Vec<u8>)> = (file.specifier_uses.iter())
        .filter_map(|used| {
            let specifier = atoms.bytes(used.spec);
            let is_relative = specifier.starts_with(b"./") || specifier.starts_with(b"../");
            let target = is_relative.then(|| absolute(directory, specifier))?;
            outputs.iter().find(|output| output.path == target)?;
            let start = used.pos as usize + 1;
            let written = text.get(start..start + specifier.len())?;
            (written == specifier).then_some(())?;
            Some((
                start,
                start + specifier.len(),
                typed_path_beside(specifier)?,
            ))
        })
        .collect();
    replacements.sort_unstable();
    replacements.dedup();
    let mut rewritten = text.to_vec();
    for (start, end, specifier) in replacements.into_iter().rev() {
        rewritten.splice(start..end, specifier);
    }
    Ok(rewritten)
}

pub fn annotate_implicit_any(
    typed: &mut [(Vec<u8>, Vec<u8>)],
    diagnostics: &[crate::Diagnostic],
) -> bool {
    let mut is_changed = false;
    for (path, text) in typed.iter_mut() {
        let in_this_file = crate::host::from_native(path);
        let mut places: Vec<(usize, &[u8])> = (diagnostics
            .iter()
            .filter(|reported| reported.path == in_this_file))
        .filter_map(|reported| match reported.code {
            7006 | 7034 => Some((reported.end as usize, &b": any"[..])),
            7019 => Some((reported.end as usize, &b": any[]"[..])),
            _ => None,
        })
        .collect();
        places.sort_unstable();
        places.dedup();
        let mut written = text.clone();
        for &(at, annotation) in places.iter().rev().filter(|place| place.0 <= text.len()) {
            let at = if text.get(at) == Some(&b'?') {
                at + 1
            } else {
                at
            };
            written.splice(at..at, annotation.iter().copied());
        }
        if !places.is_empty()
            && let Some(erased) = erase_types(path, &written)
            && erase_types(path, text) == Some(erased)
        {
            *text = written;
            is_changed = true;
        }
    }
    is_changed
}

pub fn sound_files(
    outdir: &[u8],
    outputs: &[Output<'_>],
    modules: &[ModuleTypes],
    emitted_declarations: &[ModuleTypes],
) -> Result<SoundFiles, String> {
    let outdir = outdir.strip_suffix(b"/").unwrap_or(outdir);
    let mut found = SoundFiles {
        modules_of_untyped_values: Vec::new(),
        typed: Vec::new(),
        declarations_while_checked: Vec::new(),
        dropped_casts: 0,
    };
    for (output, (typed_path, typed)) in outputs.iter().zip(typed_outputs(
        outdir,
        outputs,
        modules,
        emitted_declarations,
    )?) {
        let name_of = |path: &[u8]| {
            path[bun_core::strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1)..]
                .to_vec()
        };
        found.dropped_casts += typed.dropped_casts;
        found
            .modules_of_untyped_values
            .extend(typed.modules_of_untyped_values);
        if outputs.len() > 1
            && let Some(stem) = output.path.strip_suffix(b".js")
        {
            let name = name_of(&typed_path);
            let name = BStr::new(&name);
            let default = if typed.has_default_export {
                format!("export {{ default }} from \"./{name}\";\n")
            } else {
                String::new()
            };
            found.declarations_while_checked.push((
                [stem, b".d.ts"].concat(),
                format!("export * from \"./{name}\";\n{default}").into_bytes(),
            ));
            let folder_of = |path: &[u8]| {
                path[..bun_core::strings::last_index_of_char(path, b'/').unwrap_or(0)].to_vec()
            };
            let from_source = typed.source.as_ref().map(|source| {
                bun_sema::resolve::get_relative_path_from_directory(
                    &folder_of(source),
                    &typed_path,
                    true,
                )
            });
            if let (Some(source), Some(from_source)) = (
                typed.source,
                from_source.filter(|path| path[..] != typed_path[..]),
            ) {
                let typed_file = if from_source.starts_with(b"../") {
                    from_source
                } else {
                    [&b"./"[..], &from_source[..]].concat()
                };
                let typed_file = BStr::new(&typed_file);
                let default = if typed.has_default_export {
                    format!("export {{ default }} from \"{typed_file}\";\n")
                } else {
                    String::new()
                };
                found.declarations_while_checked.push((
                    source,
                    format!("export * from \"{typed_file}\";\n{default}").into_bytes(),
                ));
            }
        }
        found.typed.push((typed_path, typed.text));
    }
    Ok(found)
}
