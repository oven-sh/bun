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
    Reference(SRef<Reference>),
    Query(SRef<Reference>),
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

pub struct Reference {
    pub names: SSlice<(u32, u32)>,
    pub args: SSlice<Node>,
    pub args_pos: u32,
    pub args_end: u32,
    pub has_args: bool,
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

/// One type while the grammar reads it.
#[derive(Default)]
pub struct Built {
    pub node: Node,
    open: Vec<Node>,
    open_union: bool,
    lead_or: Option<u32>,
    lead_and: Option<u32>,
    cond: Option<SRef<Conditional>>,
    index: Node,
}

impl Built {
    fn close_list(&mut self, arena: &Arena) {
        if !self.open.is_empty() {
            let start = self.open[0].start;
            let end = self.open[self.open.len() - 1].end;
            let items = SSlice::new_mut(arena.alloc_slice_copy(&self.open));
            self.open.clear();
            let lead = if self.open_union { self.lead_or.take() } else { self.lead_and.take() };
            self.node = Node {
                start: lead.unwrap_or(start),
                end,
                data: if self.open_union { Data::Union(items) } else { Data::Intersection(items) },
            };
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

#[derive(Default)]
pub struct BuiltArgs {
    items: Vec<Node>,
    pos: u32,
    end: u32,
    gt_end: u32,
    found: bool,
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
    fn parenthesized(out: &mut Built, arena: &Arena, mut inner: Built) {
        let inner = inner.finish(arena);
        out.node.data = Data::Paren(SRef::from_bump(arena.alloc(inner)));
    }
    #[inline]
    fn typeof_query(_out: &mut Built) {}
    #[inline]
    fn tuple_type(_out: &mut Built) {}
    #[inline]
    fn object_type(_out: &mut Built) {}
    fn reference<'n, E>(out: &mut Built, arena: &Arena, _name: &'n [u8], _find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        let r = arena.alloc(Reference { names: SSlice::EMPTY, args: SSlice::EMPTY, args_pos: 0, args_end: 0, has_args: false });
        out.node.data = Data::Reference(SRef::from_bump(r));
        Ok(())
    }
    fn member<'n, E>(out: &mut Built, _arena: &Arena, _name: &'n [u8], _is_name: bool, _find: impl FnOnce(&'n [u8]) -> Result<Ref, E>) -> Result<(), E> {
        let _ = out;
        Ok(())
    }
    fn index_or_array(out: &mut Built, arena: &Arena, has_index: bool) {
        let object = out.finish(arena);
        let index = core::mem::take(&mut out.index);
        out.node = Node {
            start: object.start,
            end: object.end,
            data: if has_index { Data::Indexed(SRef::from_bump(arena.alloc([object, index]))) } else { Data::Array(SRef::from_bump(arena.alloc(object))) },
        };
    }
    #[inline]
    fn union_left<'n>(out: &mut Built, _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Built> {
        Operand::Open(core::mem::take(out))
    }
    fn union_right(out: &mut Built, arena: &Arena, mut left: Built) {
        let right = out.finish(arena);
        if left.open.is_empty() || !left.open_union {
            let first = { left.close_list(arena); if let Some(start) = left.lead_and.take() { let one = SSlice::new_mut(arena.alloc_slice_copy(&[left.node])); Node { start, end: left.node.end, data: Data::Intersection(one) } } else { left.node } };
            left.open.push(first);
            left.open_union = true;
        }
        left.open.push(right);
        *out = left;
    }
    fn conditional_true<'n>(out: &mut Built, mut when_true: Built, _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Built> {
        if let Some(mut cond) = out.cond {
            // The arena is not needed: the true branch was closed by `finish` in `conditional_then`.
            cond.when_true = when_true.node;
        }
        let _ = &mut when_true;
        Operand::Open(core::mem::take(out))
    }
    fn conditional_false(out: &mut Built, left: Built) {
        if let Some(mut cond) = left.cond {
            cond.when_false = out.node;
            out.node = Node { start: cond.check.start, end: out.node.end, data: Data::Conditional(cond) };
        }
    }

    #[inline]
    fn span(out: &mut Built, start: u32, end: u32) {
        out.node.start = start;
        out.node.end = end;
    }
    #[inline]
    fn end_at(out: &mut Built, end: u32) {
        out.node.end = end;
    }
    #[inline]
    fn leading_operator(out: &mut Built, is_union: bool, start: u32) {
        if is_union {
            out.lead_or = Some(start);
        } else {
            out.lead_and = Some(start);
        }
    }
    fn type_arguments(out: &mut Built, args: BuiltArgs, arena: &Arena) {
        if !args.found {
            return;
        }
        if let Data::Reference(mut r) | Data::Query(mut r) = out.node.data {
            r.args = SSlice::new_mut(arena.alloc_slice_copy(&args.items));
            r.args_pos = args.pos;
            r.args_end = args.end;
            r.has_args = true;
            out.node.end = args.gt_end;
        }
    }
    fn tuple_elements(out: &mut Built, elements: Vec<Node>, arena: &Arena) {
        out.node.data = Data::Tuple(SSlice::new_mut(arena.alloc_slice_copy(&elements)));
    }
    fn index_type(out: &mut Built, mut index: Built, arena: &Arena) {
        out.index = index.finish(arena);
    }
    fn conditional_extends(out: &mut Built, extends: &mut Built, arena: &Arena) {
        let check = out.finish(arena);
        let extends = extends.finish(arena);
        out.cond = Some(SRef::from_bump(arena.alloc(Conditional { check, extends, when_true: Node::default(), when_false: Node::default() })));
    }
    fn function_parts(out: &mut Built, params: Vec<Param>, mut ret: Built, start: u32, arena: &Arena) {
        let ret = ret.finish(arena);
        let params = SSlice::new_mut(arena.alloc_slice_copy(&params));
        out.node = Node { start, end: ret.end, data: Data::Function(SRef::from_bump(arena.alloc(Function { params, ret }))) };
    }
    fn finish(out: &mut Built, arena: &Arena) {
        out.finish(arena);
    }
    fn object_members(out: &mut Built, members: (Vec<Param>, u32), start: u32, arena: &Arena) {
        out.node = Node { start, end: members.1, data: Data::Object(SSlice::new_mut(arena.alloc_slice_copy(&members.0))) };
    }
}

impl PartSink for Build {
    type Pos = u32;
    type Types = Vec<Node>;
    type TypeArgs = BuiltArgs;
    type Params = Vec<Param>;
    type Members = (Vec<Param>, u32);

    type With<X, Y> = (X, Y);
    #[inline]
    fn with<X, Y>(x: X, y: Y) -> (X, Y) {
        (x, y)
    }
    #[inline]
    fn split<X, Y: Default>(both: (X, Y)) -> (X, Y) {
        both
    }
    fn attempt<'a, const TS: bool, F, Y: Default>(p: &mut P<'a, TS>, f: F) -> (bool, Y)
    where
        F: FnOnce(&mut P<'a, TS>) -> Result<(bool, Y), Error>,
    {
        p.lexer_backtracker_build(f)
    }

    #[inline]
    fn start(lexer: &Lexer<'_>) -> u32 {
        lexer.start as u32
    }
    #[inline]
    fn end(lexer: &Lexer<'_>) -> u32 {
        lexer.end as u32
    }
    #[inline]
    fn after_first_char(lexer: &Lexer<'_>) -> u32 {
        lexer.start as u32 + 1
    }
    fn push_type(list: &mut Vec<Node>, item: &mut Built, arena: &Arena) {
        list.push(item.finish(arena));
    }
    fn type_args(items: Vec<Node>, lt_end: u32, gt_end: u32) -> BuiltArgs {
        let end = items.last().map_or(lt_end, |n| n.end);
        BuiltArgs { items, pos: lt_end, end, gt_end, found: true }
    }
    fn members(items: Vec<Param>, end: u32) -> (Vec<Param>, u32) {
        (items, end)
    }
    fn push_param(list: &mut Vec<Param>, _name: &[u8], name_start: u32, name_end: u32, mut ty: Built, arena: &Arena) {
        list.push(Param { name_start, name_end, ty: ty.finish(arena) });
    }
}

impl<'a, const TS: bool> P<'a, TS> {
    /// `lexer_backtracker_bool` for the sink that builds: the value of the attempt is kept.
    #[cold]
    #[inline(never)]
    fn lexer_backtracker_build<F, Y: Default>(&mut self, func: F) -> (bool, Y)
    where
        F: FnOnce(&mut Self) -> Result<(bool, Y), Error>,
    {
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let result = match func(self) {
            Ok((_, parts)) => (true, parts),
            Err(_) => {
                self.lexer.restore(&old_lexer);
                (false, Y::default())
            }
        };
        self.lexer.is_log_disabled = old_log_disabled;
        result
    }
}

/// The entry that gives the Build instantiation a caller.
#[inline(never)]
pub fn parse_type_only(p: &mut P<'_, true>) -> Result<Node, Error> {
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
            kids.extend_from_slice(r.args.slice());
            if r.has_args {
                let _ = writeln!(text, "{pad} list typeArguments pos {} end {} count {}", r.args_pos, r.args_end, r.args.len);
            }
            "TypeReference"
        }
        Data::Query(r) => {
            kids.extend_from_slice(r.args.slice());
            "TypeQuery"
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
