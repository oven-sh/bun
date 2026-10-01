#!/usr/bin/env python3
"""Makes variants of a copy of src/js_parser to measure what added sink calls do to the code of the other sinks.
usage: patch.py <variant: s1|x1|x2> <directory of a fresh copy>
s1: sub-parses go through S::Sub and start from S::NONE (no new call).  x1: s1 plus calls of build hooks.
x2: the same calls inside `if S::BUILDS`."""
import sys, re, os
GROUPS = set(os.environ.get('ONLY', 'ABCDEFGH'))
CUR = 'A'
variant, d = sys.argv[1], sys.argv[2]
def rep(s, old, new, count=1):
    assert s.count(old) >= count, (old, s.count(old))
    return s.replace(old, new, count)

# ------------------------------------------------------------------ type_sink.rs
p = d + '/parse/type_sink.rs'
s = open(p).read()
s = rep(s, '''    /// Binding level of the type after the ":" of a conditional type.
    const CONDITIONAL_FALSE_LEVEL: Level;
''', '''    /// Binding level of the type after the ":" of a conditional type.
    const CONDITIONAL_FALSE_LEVEL: Level;
    /// No type read yet.
    const NONE: Self::Out;
    /// The sink that reads a part of which this sink keeps only what `Sub` keeps.
    type Sub: TypeSink<Sub = Self::Sub>;
HOOKS''')
s = rep(s, '''    type Out = ();

    const CONDITIONAL_FALSE_LEVEL: Level = Level::Lowest;
''', '''    type Out = ();

    const CONDITIONAL_FALSE_LEVEL: Level = Level::Lowest;
    const NONE: () = ();
    type Sub = Discard;
IMPL0''')
s = rep(s, '''    type Out = Metadata;

    const CONDITIONAL_FALSE_LEVEL: Level = Level::BitwiseAnd;
''', '''    type Out = Metadata;

    const CONDITIONAL_FALSE_LEVEL: Level = Level::BitwiseAnd;
    const NONE: Metadata = Metadata::MNone;
    type Sub = Discard;
IMPL0''')
hooks = '''    /// True in the sink that builds nodes.
    const BUILDS: bool;
    /// `V` in the sink that builds nodes, nothing in the others.
    type K<V: ConstDefault>: ConstDefault;
    #[inline]
    fn start(_lx: &Lexer<'_>) -> KK<Self, u32> {
        ConstDefault::DEFAULT
    }
    #[inline]
    fn node(_out: &Self::Out) -> Kept<Self> {
        <Self::Sub as TypeSink>::NONE
    }
    #[inline]
    fn b_token(_lx: &Lexer<'_>, _out: &mut Self::Out, _kind: u8) {}
    #[inline]
    fn b_name(_lx: &Lexer<'_>, _name: &mut KK<Self, BName>) {}
    #[inline]
    fn b_reference(_out: &mut Self::Out, _name: KK<Self, BName>) {}
    #[inline]
    fn b_wrap(_lx: &Lexer<'_>, _out: &mut Self::Out, _start: &KK<Self, u32>, _kind: u8, _inner: Kept<Self>) {}
    #[inline]
    fn b_postfix(_lx: &Lexer<'_>, _out: &mut Self::Out, _index: Kept<Self>) {}
    #[inline]
    fn b_list(_lx: &Lexer<'_>) -> KK<Self, BList> {
        ConstDefault::DEFAULT
    }
    #[inline]
    fn b_push(_list: &mut KK<Self, BList>, _item: Kept<Self>) {}
    #[inline]
    fn b_sep(_lx: &Lexer<'_>, _list: &mut KK<Self, BList>) {}
    #[inline]
    fn b_tuple(_lx: &Lexer<'_>, _out: &mut Self::Out, _start: &KK<Self, u32>, _list: KK<Self, BList>) {}
    #[inline]
    fn b_pair(_lx: &Lexer<'_>, _out: &mut Self::Out, _left: Kept<Self>, _kind: u8) {}
    #[inline]
    fn b_conditional(_lx: &Lexer<'_>, _out: &mut Self::Out, _check: Kept<Self>, _extends: Kept<Self>, _when_true: Kept<Self>) {}
'''
support = '''
use crate::lexer::Lexer;
use bun_ast::StoreRef;

/// A child type as the parent keeps it.
pub(crate) type Kept<S> = <<S as TypeSink>::Sub as TypeSink>::Out;
/// `V` in the sink that builds nodes, nothing in the others.
pub(crate) type KK<S, V> = <<S as TypeSink>::Sub as TypeSink>::K<V>;
/// A value to start from that costs no code.
pub(crate) trait ConstDefault {
    const DEFAULT: Self;
}
impl ConstDefault for () {
    const DEFAULT: () = ();
}
impl ConstDefault for u32 {
    const DEFAULT: u32 = 0;
}
#[derive(Clone, Copy)]
pub(crate) struct BNode {
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) kind: u8,
    pub(crate) a: Option<StoreRef<BNode>>,
    pub(crate) b: Option<StoreRef<BNode>>,
    pub(crate) list: bun_ast::StoreSlice<BNode>,
}
pub(crate) struct BName(Option<BNode>);
impl ConstDefault for BName {
    const DEFAULT: BName = BName(None);
}
pub(crate) struct BList {
    items: Vec<BNode>,
    end: u32,
}
impl ConstDefault for BList {
    const DEFAULT: BList = BList { items: Vec::new(), end: 0 };
}
fn leaf(lx: &Lexer<'_>, kind: u8) -> BNode {
    BNode { start: lx.start as u32, end: lx.end as u32, kind, a: None, b: None, list: bun_ast::StoreSlice::EMPTY }
}
fn boxed(lx: &Lexer<'_>, node: Option<BNode>) -> Option<StoreRef<BNode>> {
    node.map(|node| StoreRef::from_bump(lx.arena.alloc(node)))
}

/// Builds nodes.
pub(crate) struct Build;

impl TypeSink for Build {
    type Out = Option<BNode>;

    const CONDITIONAL_FALSE_LEVEL: Level = Level::Lowest;
    const NONE: Option<BNode> = None;
    type Sub = Build;
    const BUILDS: bool = true;
    type K<V: ConstDefault> = V;

    fn literal(_out: &mut Self::Out, _literal: TypeLiteral) {}
    fn keyword(_out: &mut Self::Out, _keyword: TypeKeyword) {}
    fn function_type(_out: &mut Self::Out) {}
    fn parenthesized(_out: &mut Self::Out, _inner: Self::Out) {}
    fn keyof_type(_out: &mut Self::Out) {}
    fn readonly_type(_out: &mut Self::Out) {}
    fn typeof_query(_out: &mut Self::Out) {}
    fn tuple_type(_out: &mut Self::Out) {}
    fn object_type(_out: &mut Self::Out) {}
    fn template_literal_type(_out: &mut Self::Out) {}
    fn reference<'a, E>(_out: &mut Self::Out, _name: &'a [u8], _find: impl FnOnce(&'a [u8]) -> Result<Ref, E>) -> Result<(), E> {
        Ok(())
    }
    fn member<'a, E>(_out: &mut Self::Out, _name: &'a [u8], _is_name: bool, _find: impl FnOnce(&'a [u8]) -> Result<Ref, E>) -> Result<(), E> {
        Ok(())
    }
    fn index_or_array(_out: &mut Self::Out, _has_index: bool) {}
    fn union_left<'n>(_out: &mut Self::Out, _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Self::Out> {
        Operand::Open(None)
    }
    fn union_right(_out: &mut Self::Out, _left: Self::Out) {}
    fn intersection_left<'n>(_out: &mut Self::Out, _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Self::Out> {
        Operand::Open(None)
    }
    fn intersection_right(_out: &mut Self::Out, _left: Self::Out) {}
    fn conditional_true<'n>(_out: &mut Self::Out, _when_true: Self::Out, _load_name: impl Fn(Ref) -> &'n [u8]) -> Operand<Self::Out> {
        Operand::Open(None)
    }
    fn conditional_false(_out: &mut Self::Out, _left: Self::Out) {}

    fn start(lx: &Lexer<'_>) -> u32 {
        lx.start as u32
    }
    fn node(out: &Self::Out) -> Option<BNode> {
        *out
    }
    fn b_token(lx: &Lexer<'_>, out: &mut Self::Out, kind: u8) {
        *out = Some(leaf(lx, kind));
    }
    fn b_name(lx: &Lexer<'_>, name: &mut BName) {
        let right = leaf(lx, 20);
        name.0 = Some(match name.0 {
            None => right,
            Some(left) => BNode { start: left.start, end: right.end, kind: 21, a: boxed(lx, Some(left)), b: boxed(lx, Some(right)), list: bun_ast::StoreSlice::EMPTY },
        });
    }
    fn b_reference(out: &mut Self::Out, name: BName) {
        if let Some(name) = name.0 {
            *out = Some(BNode { kind: 22, ..name });
        }
    }
    fn b_wrap(lx: &Lexer<'_>, out: &mut Self::Out, start: &u32, kind: u8, inner: Option<BNode>) {
        let end = inner.map_or(lx.end as u32, |inner| inner.end.max(lx.start as u32));
        *out = Some(BNode { start: *start, end, kind, a: boxed(lx, inner), b: None, list: bun_ast::StoreSlice::EMPTY });
    }
    fn b_postfix(lx: &Lexer<'_>, out: &mut Self::Out, index: Option<BNode>) {
        let Some(object) = *out else { return };
        *out = Some(BNode { start: object.start, end: lx.end as u32, kind: 30, a: boxed(lx, Some(object)), b: boxed(lx, index), list: bun_ast::StoreSlice::EMPTY });
    }
    fn b_list(lx: &Lexer<'_>) -> BList {
        BList { items: Vec::new(), end: lx.start as u32 + 1 }
    }
    fn b_push(list: &mut BList, item: Option<BNode>) {
        if let Some(item) = item {
            list.end = item.end;
            list.items.push(item);
        }
    }
    fn b_sep(lx: &Lexer<'_>, list: &mut BList) {
        list.end = lx.end as u32;
    }
    fn b_tuple(lx: &Lexer<'_>, out: &mut Self::Out, start: &u32, list: BList) {
        let items = bun_ast::StoreSlice::new_mut(lx.arena.alloc_slice_copy(&list.items));
        *out = Some(BNode { start: *start, end: lx.start as u32 + 1, kind: 40, a: None, b: None, list: items });
    }
    fn b_pair(lx: &Lexer<'_>, out: &mut Self::Out, left: Option<BNode>, kind: u8) {
        let (Some(left), Some(right)) = (left, *out) else { return };
        *out = Some(BNode { start: left.start, end: right.end, kind, a: boxed(lx, Some(left)), b: boxed(lx, Some(right)), list: bun_ast::StoreSlice::EMPTY });
    }
    fn b_conditional(lx: &Lexer<'_>, out: &mut Self::Out, check: Option<BNode>, extends: Option<BNode>, when_true: Option<BNode>) {
        let (Some(check), Some(when_false)) = (check, *out) else { return };
        let mut list = Vec::new();
        list.extend(extends);
        list.extend(when_true);
        list.push(when_false);
        let items = bun_ast::StoreSlice::new_mut(lx.arena.alloc_slice_copy(&list));
        *out = Some(BNode { start: check.start, end: when_false.end, kind: 50, a: boxed(lx, Some(check)), b: None, list: items });
    }
}
'''
if variant == 's1':
    s = s.replace('HOOKS', '').replace('IMPL0', '')
else:
    if variant == 'x1':
        hooks = hooks.replace('    /// True in the sink that builds nodes.\n    const BUILDS: bool;\n', '')
        support = support.replace('    const BUILDS: bool = true;\n', '')
        s = s.replace('HOOKS', hooks).replace('IMPL0', '    type K<V: ConstDefault> = ();\n')
    else:
        s = s.replace('HOOKS', hooks).replace('IMPL0', '    const BUILDS: bool = false;\n    type K<V: ConstDefault> = ();\n')
    s = s + support
open(p, 'w').write(s)

# ------------------------------------------------------------------ parse_skip_typescript.rs
p = d + '/parse/parse_skip_typescript.rs'
g = open(p).read()
B = (lambda body: 'if S::BUILDS {\n' + body + '\n}\n') if variant == 'x2' else (lambda body: '{\n' + body + '\n}\n')
def build(body):
    return '' if variant == 's1' or CUR not in GROUPS else B(body)
def tok(call):
    global CUR
    keep = CUR
    CUR = 'H'; before = build(call)
    CUR = 'I'; after = build(call)
    CUR = keep
    return before + '                    self.lexer.next()?;\n' + after
def state(decl):
    if variant == 's1': return ''
    if variant == 'x1':
        # without the guard the first value is never read: declare, and assign where the guarded form assigns
        out = []
        for line in decl.split('\n'):
            if 'BName' in line: out.append(line); continue
            line = line.replace(' = ConstDefault::DEFAULT;', ';').replace(' = <S::Sub as TypeSink>::NONE;', ';')
            if 'BList' not in line: line = line.replace('let mut ', 'let ')
            out.append(line)
        decl = '\n'.join(out)
    return decl + '\n'
g = rep(g, '''use crate::parse::type_sink::{
    DecoratorMetadata, Discard, Operand, TypeKeyword, TypeLiteral, TypeSink,
};''', '''use crate::parse::type_sink::{
    DecoratorMetadata, Discard, Operand, TypeKeyword, TypeLiteral, TypeSink,
};''' + ('' if variant == 's1' else '\nuse crate::parse::type_sink::{BList, BName, ConstDefault, KK, Kept};'))
CUR = 'A'
# entry of the core
g = rep(g, '''        if !self.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }

        loop {
            match self.lexer.token {
                T::TNumericLiteral => {
                    self.lexer.next()?;''', '''        if !self.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }
''' + state('let mut start: KK<S, u32> = ConstDefault::DEFAULT;') + build('start = S::start(&self.lexer);') + '''
        loop {
            match self.lexer.token {
                T::TNumericLiteral => {
''' + tok('S::b_token(&self.lexer, out, 1);') + '''''')
g = rep(g, '''                T::TBigIntegerLiteral => {
                    self.lexer.next()?;''', '''                T::TBigIntegerLiteral => {
''' + tok('S::b_token(&self.lexer, out, 2);') + '''''')
g = rep(g, '''                T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
                    self.lexer.next()?;''', '''                T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
''' + tok('S::b_token(&self.lexer, out, 3);') + '''''')
g = rep(g, '''                T::TTrue | T::TFalse => {
                    self.lexer.next()?;''', '''                T::TTrue | T::TFalse => {
''' + tok('S::b_token(&self.lexer, out, 4);') + '''''')
g = rep(g, '''                T::TNull => {
                    self.lexer.next()?;''', '''                T::TNull => {
''' + tok('S::b_token(&self.lexer, out, 5);') + '''''')
g = rep(g, '''                T::TVoid => {
                    self.lexer.next()?;''', '''                T::TVoid => {
''' + tok('S::b_token(&self.lexer, out, 6);') + '''''')
g = rep(g, '''                T::TThis => {
                    self.lexer.next()?;''', '''                T::TThis => {
''' + tok('S::b_token(&self.lexer, out, 7);') + '''''')
CUR = 'B'
# keyof / readonly operands
for hook, kind in (('keyof_type', 60), ('readonly_type', 61)):
    g = rep(g, '''                            {
                                self.skip_type_script_type(Level::Prefix)?;
                            }

                            S::%s(out);
''' % hook, '''                            {
                                self.skip_type_script_type_with_opts::<S::Sub>(
                                    Level::Prefix,
                                    SkipTypeOptionsBitset::empty(),
                                    &mut operand,
                                )?;
                            }

                            S::%s(out);
''' % hook + build('S::b_wrap(&self.lexer, out, &start, %d, operand);' % kind))
g = rep(g, '''                        TsIdentKind::PrefixKeyof => {
                            self.lexer.next()?;
''', '''                        TsIdentKind::PrefixKeyof => {
                            self.lexer.next()?;
                            let mut operand = <S::Sub as TypeSink>::NONE;
''')
g = rep(g, '''                        TsIdentKind::PrefixReadonly => {
                            self.lexer.next()?;
''', '''                        TsIdentKind::PrefixReadonly => {
                            self.lexer.next()?;
                            let mut operand = <S::Sub as TypeSink>::NONE;
''')
CUR = 'B'
# primitive keywords
for kw in ('Any', 'Never', 'Unknown', 'Undefined', 'Object', 'Number', 'String', 'Boolean', 'Bigint', 'Symbol'):
    g = rep(g, '''                        TsIdentKind::Primitive%s => {
                            self.lexer.next()?;''' % kw, '''                        TsIdentKind::Primitive%s => {
''' % kw + build('S::b_token(&self.lexer, out, 8);') + '''                            self.lexer.next()?;''')
CUR = 'C'
# a reference
g = rep(g, '''                                self.find_symbol(bun_ast::Loc::EMPTY, name)
                                    .map(|found| found.r#ref)
                            })?;

                            self.lexer.next()?;
''', '''                                self.find_symbol(bun_ast::Loc::EMPTY, name)
                                    .map(|found| found.r#ref)
                            })?;
''' + state('let mut name: KK<S, BName> = ConstDefault::DEFAULT;') + build('S::b_name(&self.lexer, &mut name);') + '''
                            self.lexer.next()?;
''' + build('S::b_reference(out, name);'))
CUR = 'D'
# a tuple
g = rep(g, '''                    self.lexer.next()?;

                    S::tuple_type(out);

                    while self.lexer.token != T::TCloseBracket {
                        if self.lexer.token == T::TDotDotDot {
                            self.lexer.next()?;
                        }
                        self.skip_type_script_type_with_opts::<Discard>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::only(SkipTypeOptions::AllowTupleLabels),
                            &mut (),
                        )?;''', state('let mut list: KK<S, BList> = ConstDefault::DEFAULT;') + build('list = S::b_list(&self.lexer);') + '''                    self.lexer.next()?;

                    S::tuple_type(out);

                    while self.lexer.token != T::TCloseBracket {
                        if self.lexer.token == T::TDotDotDot {
                            self.lexer.next()?;
                        }
                        let mut element = <S::Sub as TypeSink>::NONE;
                        self.skip_type_script_type_with_opts::<S::Sub>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::only(SkipTypeOptions::AllowTupleLabels),
                            &mut element,
                        )?;
''' + build('S::b_push(&mut list, element);'))
g = rep(g, '''                        if self.lexer.token != T::TComma {
                            break;
                        }
                        self.lexer.next()?;
                    }
                    self.lexer.expect(T::TCloseBracket)?;
                }
                T::TOpenBrace => {''', '''                        if self.lexer.token != T::TComma {
                            break;
                        }
''' + build('S::b_sep(&self.lexer, &mut list);') + '''                        self.lexer.next()?;
                    }
''' + build('S::b_tuple(&self.lexer, out, &start, list);') + '''                    self.lexer.expect(T::TCloseBracket)?;
                }
                T::TOpenBrace => {''')
CUR = 'E'
# union and intersection, one operand per turn of the loop
for name, level, kind in (('union', 'BitwiseOr', 70), ('intersection', 'BitwiseAnd', 71)):
    old = '''                        Operand::Open(left) => {
                            self.skip_type_script_type_with_opts::<S>(Level::BitwiseOr, opts, out)?;
                            S::union_right(out, left);
                        }''' if name == 'union' else '''                        Operand::Open(left) => {
                            self.skip_type_script_type_with_opts::<S>(
                                Level::BitwiseAnd,
                                opts,
                                out,
                            )?;
                            S::intersection_right(out, left);
                        }'''
    new = '''                        Operand::Open(left) => {
''' + state('let mut kept: Kept<S> = <S::Sub as TypeSink>::NONE;') + build('kept = S::node(out);') + '''                            self.skip_type_script_type_with_opts::<S>(Level::%s, opts, out)?;
''' % level + build('S::b_pair(&self.lexer, out, kept, %d);' % kind) + '''                            S::%s_right(out, left);
                        }''' % name
    g = rep(g, old, new)
CUR = 'C'
# a member after "."
g = rep(g, '''                    })?;

                    self.lexer.next()?;

                    // "{ <A extends B>(): c.d \\n <E extends F>(): g.h }" must not become a single type''', '''                    })?;
''' + build('S::b_token(&self.lexer, out, 9);') + '''
                    self.lexer.next()?;

                    // "{ <A extends B>(): c.d \\n <E extends F>(): g.h }" must not become a single type''')
CUR = 'C'
# an index
g = rep(g, '''                    let mut skipped = false;
                    if self.lexer.token != T::TCloseBracket {
                        skipped = true;
                        self.skip_type_script_type(Level::Lowest)?;
                    }
                    self.lexer.expect(T::TCloseBracket)?;
''', '''                    let mut skipped = false;
                    let mut index = <S::Sub as TypeSink>::NONE;
                    if self.lexer.token != T::TCloseBracket {
                        skipped = true;
                        self.skip_type_script_type_with_opts::<S::Sub>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::empty(),
                            &mut index,
                        )?;
                    }
''' + build('S::b_postfix(&self.lexer, out, index);') + '''                    self.lexer.expect(T::TCloseBracket)?;
''')
CUR = 'F'
# a conditional type
g = rep(g, '''                    self.lexer.next()?;

                    // The type following "extends" is not permitted to be another conditional type
                    {
                        let mut extends_out = S::Out::default();
                        self.skip_type_script_type_with_opts::<S>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::only(SkipTypeOptions::DisallowConditionalTypes),
                            &mut extends_out,
                        )?;
                    }
''', '''                    self.lexer.next()?;
''' + state('let mut check: Kept<S> = <S::Sub as TypeSink>::NONE;\nlet mut extends: Kept<S> = <S::Sub as TypeSink>::NONE;\nlet mut kept_true: Kept<S> = <S::Sub as TypeSink>::NONE;') + build('check = S::node(out);') + '''
                    // The type following "extends" is not permitted to be another conditional type
                    {
                        let mut extends_out = S::Out::default();
                        self.skip_type_script_type_with_opts::<S>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::only(SkipTypeOptions::DisallowConditionalTypes),
                            &mut extends_out,
                        )?;
''' + build('extends = S::node(&extends_out);') + '''                    }
''')
g = rep(g, '''                        &mut when_true,
                    )?;
                    self.lexer.expect(T::TColon)?;''', '''                        &mut when_true,
                    )?;
''' + build('kept_true = S::node(&when_true);') + '''                    self.lexer.expect(T::TColon)?;''')
g = rep(g, '''                            S::conditional_false(out, left);
''', '''                            S::conditional_false(out, left);
''' + build('S::b_conditional(&self.lexer, out, check, extends, kept_true);'))
CUR = 'G'
# a parenthesized type
g = rep(g, '''            self.lexer.expect(T::TOpenParen)?;
            let mut inner = S::Out::default();''', state('let mut start: KK<S, u32> = ConstDefault::DEFAULT;') + build('start = S::start(&self.lexer);') + '''            self.lexer.expect(T::TOpenParen)?;
            let mut inner = S::Out::default();''')
g = rep(g, '''            S::parenthesized(out, inner);
            self.lexer.expect(T::TCloseParen)?;''', state('let mut kept: Kept<S> = <S::Sub as TypeSink>::NONE;') + build('kept = S::node(&inner);') + '''            S::parenthesized(out, inner);
''' + build('S::b_wrap(&self.lexer, out, &start, 80, kept);') + '''            self.lexer.expect(T::TCloseParen)?;''')
if variant != 's1':
    g = rep(g, '''    pub(crate) fn skip_type_script_binding(&mut self) -> Result<(), Error> {''', '''    /// Reads one type with the sink that builds nodes.
    #[cold]
    pub(crate) fn build_type_script_type(&mut self) -> Result<Option<crate::parse::type_sink::BNode>, Error> {
        let mut out = None;
        self.skip_type_script_type_with_opts::<crate::parse::type_sink::Build>(
            Level::Lowest,
            SkipTypeOptionsBitset::empty(),
            &mut out,
        )?;
        Ok(out)
    }

    pub(crate) fn skip_type_script_binding(&mut self) -> Result<(), Error> {''')
open(p, 'w').write(g)

if variant != 's1':
    p = d + '/parse/parse_entry.rs'
    e = open(p).read()
    e = rep(e, '''    /// Bundler-only scan pass (see `bundler/cache.rs`). Never reached from''', '''    /// Reads the source as one type and says where it ends.
    #[cold]
    pub fn parse_type_syntax(mut self) -> Result<Option<(u32, u32, u8, usize)>, Error> {
        type Pi<'a> = P<'a, true, false>;
        let lexer = core::mem::replace(
            &mut self.lexer,
            js_lexer::Lexer::init_without_reading(
                self.bump.alloc(bun_ast::Log::default()),
                self.source,
                self.bump,
            ),
        );
        let options = core::mem::take(&mut self.options);
        let mut __p = init_p!(Pi<'_>;
            self.bump, self.log, self.source, self.define, lexer, options);
        // SAFETY: `init_p!` only yields after `init` succeeded.
        let p: &mut Pi<'_> = unsafe { __p.assume_init_mut() };
        let node = p.build_type_script_type()?;
        Ok(node.map(|node| {
            let children = usize::from(node.a.is_some()) + usize::from(node.b.is_some());
            (node.start, node.end, node.kind, children + node.list.slice().len())
        }))
    }

    /// Bundler-only scan pass (see `bundler/cache.rs`). Never reached from''')
    open(p, 'w').write(e)
print('patched', variant, d)
