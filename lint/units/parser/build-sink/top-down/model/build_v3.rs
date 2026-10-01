// ───────────────────────────── nodes and the Build sink (lint only) ─────────────────────────────

pub struct SRef<V>(core::ptr::NonNull<V>);
impl<V> Clone for SRef<V> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<V> Copy for SRef<V> {}
impl<V> SRef<V> {
    pub fn from_bump(r: &mut V) -> Self {
        SRef(core::ptr::NonNull::from(r))
    }
}
impl<V> core::ops::Deref for SRef<V> {
    type Target = V;
    fn deref(&self) -> &V {
        unsafe { &*self.0.as_ptr() }
    }
}
impl<V> core::ops::DerefMut for SRef<V> {
    fn deref_mut(&mut self) -> &mut V {
        unsafe { &mut *self.0.as_ptr() }
    }
}
pub struct SSlice<V> {
    ptr: core::ptr::NonNull<V>,
    len: u32,
}
impl<V> Clone for SSlice<V> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<V> Copy for SSlice<V> {}
impl<V> SSlice<V> {
    pub const EMPTY: Self = SSlice { ptr: core::ptr::NonNull::dangling(), len: 0 };
    pub fn new_mut(s: &mut [V]) -> Self {
        SSlice { ptr: unsafe { core::ptr::NonNull::new_unchecked(s.as_mut_ptr()) }, len: s.len() as u32 }
    }
    pub fn slice<'s>(self) -> &'s [V] {
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }
}

#[derive(Clone, Copy, Default)]
pub struct Node {
    pub start: u32,
    pub end: u32,
    pub data: Data,
}

#[derive(Clone, Copy, Default)]
pub enum Data {
    #[default]
    Missing,
    Keyword(u8),
    Literal(u8),
    Reference(Option<SRef<BuiltArgs>>),
    Paren(SRef<Node>),
    Tuple(SSlice<Node>),
    Array(SRef<Node>),
    Indexed(SRef<[Node; 2]>),
    NonNull(SRef<Node>),
    Union(SSlice<Node>),
    Intersection(SSlice<Node>),
    Conditional(SRef<Conditional>),
    Function(SRef<Function>),
    Object(SSlice<Param>),
}

pub struct Conditional {
    pub check: Node,
    pub extends: Node,
    pub when_true: Node,
    pub when_false: Node,
}
pub struct Function {
    pub params: SSlice<Param>,
    pub ret: Node,
}
#[derive(Clone, Copy)]
pub struct Param {
    pub name_start: u32,
    pub name_end: u32,
    pub ty: Node,
}

/// What the Build sink keeps between two hooks: it lives in the boxed side table of the parser.
#[derive(Default)]
pub struct Scratch {
    types: Vec<Node>,
    params: Vec<Param>,
    /// One entry per list that is open: lengths of `types` and `params`, and the end of the token that opened it.
    marks: Vec<(u32, u32, u32)>,
    /// One entry per attempt that is running: lengths of `types`, `params` and `marks`.
    attempts: Vec<(u32, u32, u32)>,
    name: (u32, u32),
    type_args: Option<BuiltArgs>,
    members: Option<(SSlice<Param>, u32)>,
}

/// One type while the grammar reads it.
#[derive(Default)]
pub struct Built {
    pub node: Node,
    open: Vec<Node>,
    open_union: bool,
    lead_or: Option<u32>,
    lead_and: Option<u32>,
    cond: Option<SRef<Conditional>>,
    paren: Option<Node>,
}

impl Built {
    fn close_list(&mut self, arena: &Arena) {
        if !self.open.is_empty() {
            let start = self.open[0].start;
            let end = self.open[self.open.len() - 1].end;
            let items = SSlice::new_mut(arena.alloc_slice_copy(&self.open));
            self.open.clear();
            let lead = if self.open_union { self.lead_or.take() } else { self.lead_and.take() };
            self.node = Node { start: lead.unwrap_or(start), end, data: if self.open_union { Data::Union(items) } else { Data::Intersection(items) } };
        }
    }
    /// The node, with every list closed and every leading operator applied.
    pub fn finish(&mut self, arena: &Arena) -> Node {
        self.close_list(arena);
        if let Some(start) = self.lead_and.take() {
            let one = SSlice::new_mut(arena.alloc_slice_copy(&[self.node]));
            self.node = Node { start, end: self.node.end, data: Data::Intersection(one) };
        }
        if let Some(start) = self.lead_or.take() {
            let one = SSlice::new_mut(arena.alloc_slice_copy(&[self.node]));
            self.node = Node { start, end: self.node.end, data: Data::Union(one) };
        }
        self.node
    }
}

pub struct BuiltArgs {
    items: SSlice<Node>,
    pos: u32,
    end: u32,
    gt_end: u32,
}

pub struct Build;

impl TypeSink for Build {
    type Out = Built;
    const STRICT: bool = true;
    type Nested = Build;

    #[inline]
    fn literal(out: &mut Built, literal: TypeLiteral) {
        out.node.data = Data::Literal(literal as u8);
    }
    #[inline]
    fn keyword(out: &mut Built, keyword: TypeKeyword) {
        out.node.data = Data::Keyword(keyword as u8);
    }
    #[inline]
    fn function_type(_out: &mut Built) {}
    #[inline]
    fn parenthesized(out: &mut Built, inner: Built) {
        out.paren = Some(inner.node);
    }
    #[inline]
    fn typeof_query(_out: &mut Built) {}
    #[inline]
    fn tuple_type(_out: &mut Built) {}
    #[inline]
    fn object_type(_out: &mut Built) {}
    #[inline]
    fn reference<'n, E>(out: &mut Built, _name: &'n [u8], _find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        out.node.data = Data::Reference(None);
        Ok(())
    }
    #[inline]
    fn member<'n, E>(_out: &mut Built, _name: &'n [u8], _is_name: bool, _find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        Ok(())
    }
    #[inline]
    fn index_or_array(_out: &mut Built, _has_index: bool) {}
    #[inline]
    fn union_left<'n>(out: &mut Built, _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Built> {
        Operand::Open(core::mem::take(out))
    }
    fn union_right(out: &mut Built, mut left: Built) {
        if left.open.is_empty() {
            left.open.push(left.node);
            left.open_union = true;
        }
        left.open.push(out.node);
        *out = left;
    }
    #[inline]
    fn conditional_true<'n>(out: &mut Built, when_true: Built, _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Built> {
        if let Some(mut cond) = out.cond {
            cond.when_true = when_true.node;
        }
        Operand::Open(core::mem::take(out))
    }
    #[inline]
    fn conditional_false(out: &mut Built, left: Built) {
        if let Some(mut cond) = left.cond {
            cond.when_false = out.node;
            out.node = Node { start: cond.check.start, end: out.node.end, data: Data::Conditional(cond) };
        }
    }

    fn begin<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built) {
        out.node.start = p.lexer.start as u32;
    }
    fn end<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built) {
        if let Some(inner) = out.paren.take() {
            out.node.data = Data::Paren(SRef::from_bump(p.arena.alloc(inner)));
        }
        out.node.end = p.lexer.end as u32;
    }
    fn token<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built) {
        out.node.start = p.lexer.start as u32;
        out.node.end = p.lexer.end as u32;
    }
    fn leading_operator<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built) {
        if p.lexer.token == T::Bar {
            out.lead_or = Some(p.lexer.start as u32);
        } else {
            out.lead_and = Some(p.lexer.start as u32);
        }
    }
    fn type_arguments<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built) {
        let Some(side) = p.side.as_deref_mut() else { return };
        if let Some(args) = side.build.type_args.take() {
            if let Data::Reference(slot) = &mut out.node.data {
                out.node.end = args.gt_end;
                *slot = Some(SRef::from_bump(p.arena.alloc(args)));
            }
        }
    }
    fn list_open<'a, const TS: bool>(p: &mut P<'a, TS>) {
        let Some(side) = p.side.as_deref_mut() else { return };
        let s = &mut side.build;
        s.marks.push((s.types.len() as u32, s.params.len() as u32, p.lexer.start as u32 + 1));
    }
    fn list_type<'a, const TS: bool>(p: &mut P<'a, TS>, item: &mut Built) {
        let node = item.finish(p.arena);
        let Some(side) = p.side.as_deref_mut() else { return };
        side.build.types.push(node);
    }
    fn type_arguments_close<'a, const TS: bool>(p: &mut P<'a, TS>) {
        let Some(side) = p.side.as_deref_mut() else { return };
        let s = &mut side.build;
        let Some((types, _, pos)) = s.marks.pop() else { return };
        let items = SSlice::new_mut(p.arena.alloc_slice_copy(&s.types[types as usize..]));
        s.types.truncate(types as usize);
        let end = items.slice().last().map_or(pos, |n| n.end);
        s.type_args = Some(BuiltArgs { items, pos, end, gt_end: p.lexer.start as u32 + 1 });
    }
    fn tuple_close<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built) {
        let Some(side) = p.side.as_deref_mut() else { return };
        let s = &mut side.build;
        let Some((types, _, _)) = s.marks.pop() else { return };
        out.node.data = Data::Tuple(SSlice::new_mut(p.arena.alloc_slice_copy(&s.types[types as usize..])));
        s.types.truncate(types as usize);
    }
    fn index_type<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built, index: &mut Built) {
        let object = out.finish(p.arena);
        let index = index.finish(p.arena);
        out.node.data = if matches!(index.data, Data::Missing) { Data::Array(SRef::from_bump(p.arena.alloc(object))) } else { Data::Indexed(SRef::from_bump(p.arena.alloc([object, index]))) };
    }
    fn conditional_extends<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built, extends: &mut Built) {
        let check = out.finish(p.arena);
        let extends = extends.finish(p.arena);
        out.cond = Some(SRef::from_bump(p.arena.alloc(Conditional { check, extends, when_true: Node::default(), when_false: Node::default() })));
    }
    fn parameter_name<'a, const TS: bool>(p: &mut P<'a, TS>) {
        let Some(side) = p.side.as_deref_mut() else { return };
        side.build.name = (p.lexer.start as u32, p.lexer.end as u32);
    }
    fn parameter<'a, const TS: bool>(p: &mut P<'a, TS>, ty: &mut Built) {
        let ty = ty.finish(p.arena);
        let Some(side) = p.side.as_deref_mut() else { return };
        let s = &mut side.build;
        s.params.push(Param { name_start: s.name.0, name_end: s.name.1, ty });
    }
    fn function_parts<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built, ret: &mut Built) {
        let ret = ret.finish(p.arena);
        let Some(side) = p.side.as_deref_mut() else { return };
        let s = &mut side.build;
        let Some((_, params, _)) = s.marks.pop() else { return };
        let list = SSlice::new_mut(p.arena.alloc_slice_copy(&s.params[params as usize..]));
        s.params.truncate(params as usize);
        out.node.end = ret.end;
        out.node.data = Data::Function(SRef::from_bump(p.arena.alloc(Function { params: list, ret })));
    }
    fn object_close<'a, const TS: bool>(p: &mut P<'a, TS>) {
        let Some(side) = p.side.as_deref_mut() else { return };
        let s = &mut side.build;
        let Some((_, params, _)) = s.marks.pop() else { return };
        let list = SSlice::new_mut(p.arena.alloc_slice_copy(&s.params[params as usize..]));
        s.params.truncate(params as usize);
        s.members = Some((list, p.lexer.end as u32));
    }
    fn object_members<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built) {
        let Some(side) = p.side.as_deref_mut() else { return };
        if let Some((list, end)) = side.build.members.take() {
            out.node.end = end;
            out.node.data = Data::Object(list);
        }
    }
    fn attempt_begin<'a, const TS: bool>(p: &mut P<'a, TS>) {
        let Some(side) = p.side.as_deref_mut() else { return };
        let s = &mut side.build;
        s.attempts.push((s.types.len() as u32, s.params.len() as u32, s.marks.len() as u32));
    }
    fn attempt_end<'a, const TS: bool>(p: &mut P<'a, TS>, kept: bool) {
        let Some(side) = p.side.as_deref_mut() else { return };
        let s = &mut side.build;
        let Some((types, params, marks)) = s.attempts.pop() else { return };
        if !kept {
            s.types.truncate(types as usize);
            s.params.truncate(params as usize);
            s.marks.truncate(marks as usize);
            s.type_args = None;
            s.members = None;
        }
    }
    fn close<'a, const TS: bool>(p: &mut P<'a, TS>, out: &mut Built) {
        out.finish(p.arena);
    }
}

/// The entry that gives the Build instantiation a caller.
#[inline(never)]
pub fn parse_type_only(p: &mut P<'_, true>) -> Result<Node, Error> {
    p.side = Some(Box::default());
    p.lexer.next()?;
    let mut out = Built::default();
    p.skip_type_with_opts::<Build>(Level::Lowest, 0, &mut out)?;
    Ok(out.finish(p.arena))
}

pub fn dump(node: &Node, depth: usize, text: &mut String) {
    use core::fmt::Write;
    let pad = " ".repeat(depth);
    let mut kids: Vec<Node> = Vec::new();
    let name = match node.data {
        Data::Missing => "Missing",
        Data::Keyword(_) => "Keyword",
        Data::Literal(_) => "Literal",
        Data::Reference(r) => {
            if let Some(r) = r {
                kids.extend_from_slice(r.items.slice());
                let _ = writeln!(text, "{pad} list typeArguments pos {} end {} count {}", r.pos, r.end, r.items.len);
            }
            "TypeReference"
        }
        Data::Paren(n) => {
            kids.push(*n);
            "ParenthesizedType"
        }
        Data::Tuple(s) => {
            kids.extend_from_slice(s.slice());
            "TupleType"
        }
        Data::Array(n) => {
            kids.push(*n);
            "ArrayType"
        }
        Data::Indexed(n) => {
            kids.extend_from_slice(&n[..]);
            "IndexedAccessType"
        }
        Data::NonNull(n) => {
            kids.push(*n);
            "JSDocNonNullableType"
        }
        Data::Union(s) => {
            kids.extend_from_slice(s.slice());
            "UnionType"
        }
        Data::Intersection(s) => {
            kids.extend_from_slice(s.slice());
            "IntersectionType"
        }
        Data::Conditional(c) => {
            kids.extend_from_slice(&[c.check, c.extends, c.when_true, c.when_false]);
            "ConditionalType"
        }
        Data::Function(f) => {
            for p in f.params.slice() {
                kids.push(p.ty);
            }
            kids.push(f.ret);
            "FunctionType"
        }
        Data::Object(s) => {
            for p in s.slice() {
                kids.push(p.ty);
            }
            "TypeLiteral"
        }
    };
    let _ = writeln!(text, "{pad}{name} start {} end {}", node.start, node.end);
    for k in &kids {
        dump(k, depth + 1, text);
    }
}
