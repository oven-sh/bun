//! Selectors for `bun:dom`: a selector string becomes a flat list of ops, from which `BunSelectorParser.cpp` builds WebCore's `CSSSelectorList`.

use bun_alloc::Arena;
use bun_core::strings;

use crate::css_parser::ParserOpts;
use crate::css_properties::custom::TokenOrValue;
use crate::css_values::ident::{IdentOrRef, is_reserved_custom_ident};
use crate::{Parser, ParserFlags, ParserInput, ParserOptions, Token, TokenList, VendorPrefix};

use super::parser::{
    Combinator, Component, Direction, NestingRequirement, NthSelectorData, NthType,
    ParseErrorRecovery, PseudoClass, PseudoElement, Selector, SelectorFlags, SelectorList,
    SelectorParser, attrs,
};

// ─── The C ABI. `BunSelectorParser.cpp` mirrors every type and number below. ───

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum OpKind {
    /// `name` is the local name as written, or `*`.
    Tag = 0,
    Id = 1,
    Class = 2,
    /// `[name]`
    AttributeSet = 3,
    /// `[name=value]`
    AttributeExact = 4,
    /// `[name~=value]`
    AttributeList = 5,
    /// `[name|=value]`
    AttributeHyphen = 6,
    /// `[name^=value]`
    AttributeBegin = 7,
    /// `[name$=value]`
    AttributeEnd = 8,
    /// `[name*=value]`
    AttributeContain = 9,
    /// `detail` says which one.
    PseudoClass = 10,
    /// The element `:has()` is tested on. It is the leftmost op of every argument of `:has()`, and occurs nowhere else.
    HasScope = 11,
    /// One item of the argument list of `:lang()`, in `name`.
    String = 12,
    /// One item of the argument list of `:heading()`, in `a`.
    Integer = 13,
}

/// How an op relates to the next op of its complex selector, which is the simple selector or compound to its left.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Relation {
    /// The next op belongs to the same compound.
    Subselector = 0,
    Descendant = 1,
    Child = 2,
    DirectAdjacent = 3,
    IndirectAdjacent = 4,
    /// There is no next op: the complex selector ends here.
    End = 255,
}

/// The namespace part of a type or attribute selector.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Namespace {
    /// `a`
    Unspecified = 0,
    /// `*|a`
    Any = 1,
    /// `|a`
    None = 2,
}

/// How the value of an attribute selector is compared.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum AttributeCase {
    Sensitive = 0,
    Insensitive = 1,
    /// Insensitive for an HTML element in an HTML document, sensitive otherwise.
    InsensitiveInHtml = 2,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum PseudoClassKind {
    Root = 0,
    Empty = 1,
    Scope = 2,
    FirstChild = 3,
    LastChild = 4,
    OnlyChild = 5,
    FirstOfType = 6,
    LastOfType = 7,
    OnlyOfType = 8,
    /// `a` and `b`, and the `of` list as arguments if there is one.
    NthChild = 9,
    NthLastChild = 10,
    NthOfType = 11,
    NthLastOfType = 12,
    /// At least one argument.
    Not = 13,
    /// Any number of arguments, also none.
    Is = 14,
    Where = 15,
    WebKitAny = 16,
    /// At least one argument, each ending in a `HasScope`.
    Has = 17,
    /// No argument, or one compound.
    Host = 18,
    /// At least one `String`.
    Lang = 19,
    /// `name` is `ltr` or `rtl`.
    Dir = 20,
    /// `name` is the state.
    State = 21,
    Hover = 22,
    Active = 23,
    Focus = 24,
    FocusVisible = 25,
    FocusWithin = 26,
    AnyLink = 27,
    Link = 28,
    Visited = 29,
    Target = 30,
    Enabled = 31,
    Disabled = 32,
    ReadOnly = 33,
    ReadWrite = 34,
    PlaceholderShown = 35,
    Default = 36,
    Checked = 37,
    Indeterminate = 38,
    Valid = 39,
    Invalid = 40,
    InRange = 41,
    OutOfRange = 42,
    Required = 43,
    Optional = 44,
    UserValid = 45,
    UserInvalid = 46,
    Open = 47,
    Modal = 48,
    PopoverOpen = 49,
    Defined = 50,
    /// Any number of `Integer`s, also none.
    Heading = 51,
}

/// UTF-8. `ptr` is not null, also when `len` is 0.
#[repr(C)]
#[derive(Clone, Copy)]
struct StringSlice {
    ptr: *const u8,
    len: usize,
}

/// One simple selector. The ops are in the order of WebCore's array: compounds right to left, simple selectors in a compound left to right.
#[repr(C)]
#[derive(Clone, Copy)]
struct SelectorOp {
    kind: OpKind,
    relation: Relation,
    /// `OpKind::PseudoClass`: a `PseudoClassKind`. Attribute kinds: an `AttributeCase`.
    detail: u8,
    namespace: Namespace,
    /// How many of the ops that follow are the argument list of this one. They come before the next op of this complex selector.
    nested_count: u32,
    a: i32,
    b: i32,
    name: StringSlice,
    value: StringSlice,
}

/// Owns `ops` and `strings`. Every `StringSlice` of `ops` points into `strings`, so nothing refers to the parsed input.
#[repr(C)]
struct SelectorOpList {
    ops: *mut SelectorOp,
    ops_len: usize,
    strings: *mut u8,
    strings_len: usize,
}

/// Returns false if `input` (UTF-8, only read during the call) is not a valid selector list. Otherwise writes `result`, which the caller owns until it passes it to `Bun__CSS__freeSelectorListForDOM`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__CSS__parseSelectorListForDOM(
    input: *const u8,
    input_len: usize,
    result: *mut SelectorOpList,
) -> bool {
    if input_len == 0 {
        return false;
    }
    // SAFETY: the caller passes a valid pointer and length.
    let input = unsafe { core::slice::from_raw_parts(input, input_len) };
    let Some(list) = parse_selector_list(input) else {
        return false;
    };
    // SAFETY: the caller passes a pointer that is valid for a write.
    unsafe { result.write(list) };
    true
}

/// Frees what a call of `Bun__CSS__parseSelectorListForDOM` that returned true wrote. `list` itself stays the caller's.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__CSS__freeSelectorListForDOM(list: *mut SelectorOpList) {
    // SAFETY: the caller gives the list back, and does not use it again.
    drop(unsafe { list.read() });
}

// ─── The parser ───

/// `None` if `input` is not a selector list that `querySelector` accepts.
fn parse_selector_list(input: &[u8]) -> Option<SelectorOpList> {
    parse(input, false, SelectorOpList::new)
}

/// What `@supports selector()` asks: is `input` one complex selector, with nothing in it that `:is()` or `:where()` has to forgive?
pub(crate) fn supports_selector(input: &[u8]) -> bool {
    parse(input, true, drop).is_some()
}

/// `finish` gets the ops while `input` and the arena, which their strings point into, are alive.
fn parse<T>(
    input: &[u8],
    is_for_supports: bool,
    finish: impl FnOnce(Vec<SelectorOp>) -> T,
) -> Option<T> {
    let arena = Arena::new();
    let mut options = ParserOptions::default(None);
    if is_for_supports {
        options.flags |= ParserFlags::UNFORGIVING_SELECTORS;
    }
    let mut parser_input = ParserInput::new(input, &arena);
    let mut parser = Parser::new(&mut parser_input, None, ParserOpts::default(), None);
    let mut selector_parser = SelectorParser {
        is_nesting_allowed: true,
        options: &options,
    };
    let list = SelectorList::parse(
        &mut selector_parser,
        &mut parser,
        ParseErrorRecovery::DiscardList,
        NestingRequirement::None,
    )
    .ok()?;

    if is_for_supports && list.v.len() != 1 {
        return None;
    }

    let mut emitter = Emitter {
        ops: Vec::new(),
        is_for_supports,
    };
    emitter.emit_list(list.v.slice(), Context::TOP_LEVEL).ok()?;
    Some(finish(emitter.ops))
}

impl StringSlice {
    const EMPTY: StringSlice = StringSlice::new(b"");

    const fn new(bytes: &[u8]) -> StringSlice {
        StringSlice {
            ptr: bytes.as_ptr(),
            len: bytes.len(),
        }
    }
}

impl SelectorOp {
    fn new(kind: OpKind) -> SelectorOp {
        SelectorOp {
            kind,
            relation: Relation::Subselector,
            detail: 0,
            namespace: Namespace::Unspecified,
            nested_count: 0,
            a: 0,
            b: 0,
            name: StringSlice::EMPTY,
            value: StringSlice::EMPTY,
        }
    }

    fn named(kind: OpKind, name: &[u8]) -> SelectorOp {
        SelectorOp {
            name: StringSlice::new(name),
            ..SelectorOp::new(kind)
        }
    }

    fn pseudo_class(kind: PseudoClassKind) -> SelectorOp {
        SelectorOp {
            detail: kind as u8,
            ..SelectorOp::new(OpKind::PseudoClass)
        }
    }

    fn attribute(kind: OpKind, name: &[u8], value: &[u8], case: AttributeCase) -> SelectorOp {
        SelectorOp {
            detail: case as u8,
            value: StringSlice::new(value),
            ..SelectorOp::named(kind, name)
        }
    }
}

impl SelectorOpList {
    /// The strings of `ops` still point into the parser's input and arena. This copies them.
    fn new(ops: Vec<SelectorOp>) -> SelectorOpList {
        let mut strings: Vec<u8> = Vec::new();
        for op in &ops {
            for string in [op.name, op.value] {
                // SAFETY: `parse` calls this while the input and the arena are alive.
                strings.extend_from_slice(unsafe {
                    core::slice::from_raw_parts(string.ptr, string.len)
                });
            }
        }
        let strings_len = strings.len();
        let strings = Box::into_raw(strings.into_boxed_slice()).cast::<u8>();

        let mut ops = ops.into_boxed_slice();
        let mut offset = 0;
        for op in ops.iter_mut() {
            for string in [&mut op.name, &mut op.value] {
                // SAFETY: the lengths add up to `strings_len`, in the order of the loop above.
                string.ptr = unsafe { strings.add(offset) };
                offset += string.len;
            }
        }
        let ops_len = ops.len();
        SelectorOpList {
            ops: Box::into_raw(ops).cast::<SelectorOp>(),
            ops_len,
            strings,
            strings_len,
        }
    }
}

impl Drop for SelectorOpList {
    fn drop(&mut self) {
        let ops = core::ptr::slice_from_raw_parts_mut(self.ops, self.ops_len);
        let strings = core::ptr::slice_from_raw_parts_mut(self.strings, self.strings_len);
        // SAFETY: both are the boxed slices that `new` turned into raw pointers.
        unsafe {
            drop(Box::from_raw(ops));
            drop(Box::from_raw(strings));
        }
    }
}

// ─── From the AST to ops ───

/// The selector is not valid in `querySelector`. In a forgiving list this drops one member, elsewhere the whole string.
struct Invalid;

type Emit = Result<(), Invalid>;

#[derive(Clone, Copy)]
struct Context {
    /// Pseudo-elements are only valid outside of functional pseudo-classes.
    is_top_level: bool,
    /// `:has()` is not valid inside `:has()`.
    is_inside_has: bool,
}

impl Context {
    const TOP_LEVEL: Context = Context {
        is_top_level: true,
        is_inside_has: false,
    };

    fn nested(self) -> Context {
        Context {
            is_top_level: false,
            ..self
        }
    }
}

/// What may come after a pseudo-element in the same compound.
#[derive(Clone, Copy, PartialEq, Eq)]
enum FollowedBy {
    Nothing,
    /// `:hover`, `:active`, `:focus`, `:focus-visible`, `:focus-within`
    UserActionPseudoClasses,
    ScrollbarPseudoClasses,
    OnlyChild,
    /// After `::part()`: pseudo-classes that do not look at the tree, and other pseudo-elements.
    PartState,
    /// After `::slotted()`.
    TreeAbidingPseudoElements,
}

#[derive(Clone, Copy)]
struct PseudoElementRules {
    followed_by: FollowedBy,
    is_tree_abiding: bool,
}

/// A whitelist: every `match` names the variants it accepts, and none has an arm that accepts the rest.
struct Emitter {
    ops: Vec<SelectorOp>,
    is_for_supports: bool,
}

impl Emitter {
    fn push(&mut self, op: SelectorOp) -> usize {
        self.ops.push(op);
        self.ops.len() - 1
    }

    /// `:not(*)` stands for everything that is valid and cannot match in `bun:dom`.
    fn emit_never(&mut self) -> usize {
        let index = self.push(SelectorOp {
            nested_count: 1,
            ..SelectorOp::pseudo_class(PseudoClassKind::Not)
        });
        self.push(SelectorOp {
            relation: Relation::End,
            ..SelectorOp::named(OpKind::Tag, b"*")
        });
        index
    }

    /// Emits a pseudo-class and, through `emit_arguments`, its argument list.
    fn emit_functional(
        &mut self,
        op: SelectorOp,
        emit_arguments: impl FnOnce(&mut Emitter) -> Emit,
    ) -> Emit {
        let index = self.push(op);
        emit_arguments(self)?;
        self.close_functional(index)
    }

    fn close_functional(&mut self, index: usize) -> Emit {
        self.ops[index].nested_count =
            u32::try_from(self.ops.len() - index - 1).map_err(|_| Invalid)?;
        Ok(())
    }

    fn emit_list(&mut self, selectors: &[Selector], context: Context) -> Emit {
        if selectors.is_empty() {
            return Err(Invalid);
        }
        for selector in selectors {
            self.emit_complex(selector, context, false)?;
        }
        Ok(())
    }

    fn emit_forgiving_list(&mut self, selectors: &[Selector], context: Context) -> Emit {
        if self.is_for_supports {
            return self.emit_list(selectors, context);
        }
        for selector in selectors {
            let mark = self.ops.len();
            if self.emit_complex(selector, context, false).is_err() {
                self.ops.truncate(mark);
            }
        }
        Ok(())
    }

    fn emit_complex(
        &mut self,
        selector: &Selector,
        context: Context,
        is_has_argument: bool,
    ) -> Emit {
        let mut components: &[Component] = &selector.components;

        let pseudo_element_flags =
            SelectorFlags::HAS_PSEUDO | SelectorFlags::HAS_SLOTTED | SelectorFlags::HAS_PART;
        if selector
            .specificity_and_flags
            .flags
            .intersects(pseudo_element_flags)
        {
            if !context.is_top_level {
                return Err(Invalid);
            }
            // No element is a pseudo-element, so all that counts is whether the selector is valid.
            let mark = self.ops.len();
            self.check_selector_with_pseudo_element(components)?;
            self.ops.truncate(mark);
            let index = self.emit_never();
            self.ops[index].relation = Relation::End;
            return Ok(());
        }

        let mut leftmost_relation = Relation::End;
        if is_has_argument {
            leftmost_relation = Relation::Descendant;
            if selector.has_relative_anchor() {
                let [
                    rest @ ..,
                    Component::Combinator(combinator),
                    Component::Scope,
                ] = components
                else {
                    return Err(Invalid);
                };
                leftmost_relation = relation_for(*combinator)?;
                components = rest;
            }
        }

        let mut start = 0;
        loop {
            let end = components[start..]
                .iter()
                .position(|component| matches!(component, Component::Combinator(_)))
                .map_or(components.len(), |length| start + length);
            let relation = match components.get(end) {
                Some(Component::Combinator(combinator)) => relation_for(*combinator)?,
                _ => leftmost_relation,
            };
            self.emit_compound(&components[start..end], relation, context)?;
            if end == components.len() {
                break;
            }
            start = end + 1;
        }

        if is_has_argument {
            self.push(SelectorOp {
                relation: Relation::End,
                ..SelectorOp::new(OpKind::HasScope)
            });
        }
        Ok(())
    }

    /// `relation` is what joins the compound to the one on its left.
    fn emit_compound(
        &mut self,
        compound: &[Component],
        relation: Relation,
        context: Context,
    ) -> Emit {
        let (namespace, rest) = match compound {
            [Component::ExplicitAnyNamespace, rest @ ..] => (Namespace::Any, rest),
            [Component::ExplicitNoNamespace, rest @ ..] => (Namespace::None, rest),
            _ => (Namespace::Unspecified, compound),
        };

        let mut last = None;
        let rest = match rest {
            [Component::LocalName(local_name), rest @ ..] => {
                last = Some(self.push(SelectorOp {
                    namespace,
                    ..SelectorOp::named(OpKind::Tag, local_name.name.v())
                }));
                rest
            }
            [Component::ExplicitUniversalType, rest @ ..] => {
                // `*.a` is `.a`. `*:host` is not `:host`: it matches nothing.
                let says_nothing =
                    namespace != Namespace::None && !matches!(rest, [] | [Component::Host(_), ..]);
                if !says_nothing {
                    last = Some(self.push(SelectorOp {
                        namespace,
                        ..SelectorOp::named(OpKind::Tag, b"*")
                    }));
                }
                rest
            }
            _ if namespace != Namespace::Unspecified => return Err(Invalid),
            _ => rest,
        };

        for component in rest {
            last = Some(self.emit_simple(component, context)?);
        }

        let Some(last) = last else {
            return Err(Invalid);
        };
        self.ops[last].relation = relation;
        Ok(())
    }

    /// Returns the index of the op, which its arguments follow.
    fn emit_simple(&mut self, component: &Component, context: Context) -> Result<usize, Invalid> {
        use PseudoClassKind as K;

        let index = self.ops.len();
        match component {
            Component::Id(id) => {
                self.push(SelectorOp::named(OpKind::Id, plain_ident(*id)?));
            }
            Component::Class(class) => {
                self.push(SelectorOp::named(OpKind::Class, plain_ident(*class)?));
            }
            Component::AttributeInNoNamespaceExists {
                local_name,
                local_name_lower: _,
            } => {
                self.push(SelectorOp::attribute(
                    OpKind::AttributeSet,
                    local_name.v(),
                    b"",
                    AttributeCase::Sensitive,
                ));
            }
            Component::AttributeInNoNamespace {
                local_name,
                operator,
                value,
                case_sensitivity,
                never_matches: _,
            } => {
                self.push(SelectorOp::attribute(
                    attribute_kind(*operator),
                    local_name.v(),
                    // SAFETY: the value lives in the input or the arena, like every string of the AST.
                    unsafe { crate::arena_str(*value) },
                    attribute_case(*case_sensitivity),
                ));
            }
            Component::AttributeOther(attribute) => {
                let namespace = match &attribute.namespace {
                    None => Namespace::Unspecified,
                    Some(attrs::NamespaceConstraint::Any) => Namespace::Any,
                    // No prefix is declared outside of a style sheet.
                    Some(attrs::NamespaceConstraint::Specific(_)) => return Err(Invalid),
                };
                let op = match &attribute.operation {
                    attrs::ParsedAttrSelectorOperation::Exists => SelectorOp::attribute(
                        OpKind::AttributeSet,
                        attribute.local_name.v(),
                        b"",
                        AttributeCase::Sensitive,
                    ),
                    attrs::ParsedAttrSelectorOperation::WithValue {
                        operator,
                        case_sensitivity,
                        expected_value,
                    } => SelectorOp::attribute(
                        attribute_kind(*operator),
                        attribute.local_name.v(),
                        // SAFETY: the value lives in the input or the arena, like every string of the AST.
                        unsafe { crate::arena_str(*expected_value) },
                        attribute_case(*case_sensitivity),
                    ),
                };
                self.push(SelectorOp { namespace, ..op });
            }
            Component::Root => {
                self.push(SelectorOp::pseudo_class(K::Root));
            }
            Component::Empty => {
                self.push(SelectorOp::pseudo_class(K::Empty));
            }
            Component::Scope => {
                self.push(SelectorOp::pseudo_class(K::Scope));
            }
            Component::Nth(data) => {
                self.push(nth_op(*data)?);
            }
            Component::NthOf(nth_of) => {
                self.emit_functional(nth_op(nth_of.data)?, |this| {
                    this.emit_list(&nth_of.selectors, context.nested())
                })?;
            }
            Component::Negation(selectors) => {
                self.emit_functional(SelectorOp::pseudo_class(K::Not), |this| {
                    this.emit_list(selectors, context.nested())
                })?;
            }
            Component::Is(selectors) => {
                self.emit_functional(SelectorOp::pseudo_class(K::Is), |this| {
                    this.emit_forgiving_list(selectors, context.nested())
                })?;
            }
            Component::Where(selectors) => {
                self.emit_functional(SelectorOp::pseudo_class(K::Where), |this| {
                    this.emit_forgiving_list(selectors, context.nested())
                })?;
            }
            Component::Any {
                vendor_prefix,
                selectors,
            } => {
                if *vendor_prefix != VendorPrefix::WEBKIT {
                    return Err(Invalid);
                }
                self.emit_functional(SelectorOp::pseudo_class(K::WebKitAny), |this| {
                    this.emit_forgiving_list(selectors, context.nested())
                })?;
            }
            Component::Has(selectors) => {
                if context.is_inside_has || selectors.is_empty() {
                    return Err(Invalid);
                }
                let context = Context {
                    is_top_level: false,
                    is_inside_has: true,
                };
                self.emit_functional(SelectorOp::pseudo_class(K::Has), |this| {
                    for selector in selectors.iter() {
                        this.emit_complex(selector, context, true)?;
                    }
                    Ok(())
                })?;
            }
            Component::Host(None) => {
                self.push(SelectorOp::pseudo_class(K::Host));
            }
            Component::Host(Some(selector)) => {
                self.emit_functional(SelectorOp::pseudo_class(K::Host), |this| {
                    this.emit_complex(selector, context.nested(), false)
                })?;
            }
            Component::NonTsPseudoClass(pseudo_class) => self.emit_pseudo_class(pseudo_class)?,
            // Outside of a style rule `&` is `:where(:scope)`.
            Component::Nesting => {
                self.push(SelectorOp {
                    nested_count: 1,
                    ..SelectorOp::pseudo_class(K::Where)
                });
                self.push(SelectorOp {
                    relation: Relation::End,
                    ..SelectorOp::pseudo_class(K::Scope)
                });
            }
            // `emit_compound` takes a type selector off the start of a compound. It is not valid anywhere else: `&a`.
            Component::LocalName(_)
            | Component::ExplicitUniversalType
            | Component::ExplicitAnyNamespace
            | Component::ExplicitNoNamespace => return Err(Invalid),
            // No prefix is declared outside of a style sheet.
            Component::DefaultNamespace(_) | Component::Namespace { .. } => return Err(Invalid),
            // `emit_complex` sends a selector that has one of these to `check_selector_with_pseudo_element`.
            Component::PseudoElement(_) | Component::Slotted(_) | Component::Part(_) => {
                return Err(Invalid);
            }
            Component::Combinator(_) => return Err(Invalid),
        }
        Ok(index)
    }

    fn emit_pseudo_class(&mut self, pseudo_class: &PseudoClass) -> Emit {
        use PseudoClass as P;
        use PseudoClassKind as K;

        let kind = match pseudo_class {
            P::Lang { languages } => {
                if languages.is_empty() {
                    return Err(Invalid);
                }
                return self.emit_functional(SelectorOp::pseudo_class(K::Lang), |this| {
                    for language in languages {
                        this.push(SelectorOp {
                            relation: Relation::End,
                            ..SelectorOp::named(OpKind::String, language)
                        });
                    }
                    Ok(())
                });
            }
            P::Dir { direction } => {
                let name: &[u8] = match direction {
                    Direction::Ltr => b"ltr",
                    Direction::Rtl => b"rtl",
                };
                self.push(SelectorOp {
                    name: StringSlice::new(name),
                    ..SelectorOp::pseudo_class(K::Dir)
                });
                return Ok(());
            }
            P::State { name } => {
                self.push(SelectorOp {
                    name: StringSlice::new(name),
                    ..SelectorOp::pseudo_class(K::State)
                });
                return Ok(());
            }

            P::Hover => K::Hover,
            P::Active => K::Active,
            P::Focus => K::Focus,
            P::FocusVisible => K::FocusVisible,
            P::FocusWithin => K::FocusWithin,
            P::AnyLink(prefix) if is_unprefixed_or_webkit(*prefix) => K::AnyLink,
            P::Link => K::Link,
            P::Visited => K::Visited,
            P::Target => K::Target,
            P::Enabled => K::Enabled,
            P::Disabled => K::Disabled,
            P::ReadOnly(prefix) if *prefix == VendorPrefix::NONE => K::ReadOnly,
            P::ReadWrite(prefix) if *prefix == VendorPrefix::NONE => K::ReadWrite,
            P::PlaceholderShown(prefix) if *prefix == VendorPrefix::NONE => K::PlaceholderShown,
            P::Default => K::Default,
            P::Checked => K::Checked,
            P::Indeterminate => K::Indeterminate,
            P::Valid => K::Valid,
            P::Invalid => K::Invalid,
            P::InRange => K::InRange,
            P::OutOfRange => K::OutOfRange,
            P::Required => K::Required,
            P::Optional => K::Optional,
            P::UserValid => K::UserValid,
            P::UserInvalid => K::UserInvalid,
            P::Open => K::Open,
            P::Modal => K::Modal,
            P::PopoverOpen => K::PopoverOpen,
            P::Defined => K::Defined,

            // Valid, but `bun:dom` has no media elements, text tracks, fullscreen or autofill.
            P::UnknownDir { .. }
            | P::Past
            | P::Future
            | P::Playing
            | P::Paused
            | P::Seeking
            | P::Buffering
            | P::Stalled
            | P::Muted
            | P::VolumeLocked
            | P::PictureInPicture => {
                self.emit_never();
                return Ok(());
            }
            P::Fullscreen(prefix) | P::Autofill(prefix) if is_unprefixed_or_webkit(*prefix) => {
                self.emit_never();
                return Ok(());
            }
            // The parser does not know `:heading`.
            P::Custom { name }
                if strings::eql_case_insensitive_ascii_check_length(name, b"heading") =>
            {
                K::Heading
            }
            P::CustomFunction { name, arguments }
                if strings::eql_case_insensitive_ascii_check_length(name, b"heading") =>
            {
                return self.emit_functional(SelectorOp::pseudo_class(K::Heading), |this| {
                    this.emit_integer_list(arguments)
                });
            }
            // The parser does not know these two, and `bun:dom` has no view transitions.
            P::Custom { name }
                if strings::eql_case_insensitive_ascii_check_length(
                    name,
                    b"active-view-transition",
                ) =>
            {
                self.emit_never();
                return Ok(());
            }
            P::CustomFunction { name, arguments }
                if strings::eql_case_insensitive_ascii_check_length(
                    name,
                    b"active-view-transition-type",
                ) && is_custom_ident_list(arguments) =>
            {
                self.emit_never();
                return Ok(());
            }

            // Prefixes of other engines.
            P::AnyLink(_)
            | P::ReadOnly(_)
            | P::ReadWrite(_)
            | P::PlaceholderShown(_)
            | P::Fullscreen(_)
            | P::Autofill(_) => return Err(Invalid),
            // No browser, or only one, has these.
            P::Current | P::Closed | P::LocalLink | P::TargetWithin | P::Blank => {
                return Err(Invalid);
            }
            // CSS modules.
            P::Local { .. } | P::Global { .. } => return Err(Invalid),
            // Only valid after a scrollbar pseudo-element.
            P::WebkitScrollbar(_) => return Err(Invalid),
            // Names the parser does not know.
            P::Custom { .. } | P::CustomFunction { .. } => return Err(Invalid),
        };
        self.push(SelectorOp::pseudo_class(kind));
        Ok(())
    }

    /// At least one integer, with commas in between.
    fn emit_integer_list(&mut self, arguments: &TokenList) -> Emit {
        let mut expects_integer = true;
        for token in &arguments.v {
            match token {
                TokenOrValue::Token(Token::Whitespace(_)) => {}
                TokenOrValue::Token(Token::Number(number)) if expects_integer => {
                    self.push(SelectorOp {
                        relation: Relation::End,
                        a: number.int_value.ok_or(Invalid)?,
                        ..SelectorOp::new(OpKind::Integer)
                    });
                    expects_integer = false;
                }
                TokenOrValue::Token(Token::Comma) if !expects_integer => expects_integer = true,
                _ => return Err(Invalid),
            }
        }
        if expects_integer {
            return Err(Invalid);
        }
        Ok(())
    }

    /// After `::part()`: a pseudo-class that does not look at the tree, or `:is()`, `:where()`, `:not()` of such.
    fn is_valid_after_part(&mut self, component: &Component) -> bool {
        match component {
            Component::NonTsPseudoClass(pseudo_class) => {
                self.emit_pseudo_class(pseudo_class).is_ok()
            }
            // What is not valid in there is forgiven.
            Component::Is(_) | Component::Where(_) if !self.is_for_supports => true,
            Component::Is(selectors)
            | Component::Where(selectors)
            | Component::Negation(selectors) => {
                !selectors.is_empty()
                    && selectors.iter().all(|selector| {
                        selector
                            .components
                            .iter()
                            .all(|component| self.is_valid_after_part(component))
                    })
            }
            _ => false,
        }
    }

    /// Walks the selector from left to right. What it emits only serves to validate, and the caller discards it.
    fn check_selector_with_pseudo_element(&mut self, components: &[Component]) -> Emit {
        let context = Context::TOP_LEVEL.nested();
        let mut followed_by: Option<FollowedBy> = None;

        // The leftmost compound is the last one of `components`.
        let mut end = components.len();
        loop {
            let start = components[..end]
                .iter()
                .rposition(|component| matches!(component, Component::Combinator(_)))
                .map_or(0, |index| index + 1);
            let mut compound = &components[start..end];

            if followed_by.is_none() {
                let length = compound
                    .iter()
                    .position(is_pseudo_element)
                    .unwrap_or(compound.len());
                if length > 0 {
                    self.emit_compound(&compound[..length], Relation::End, context)?;
                }
                compound = &compound[length..];
            }

            for component in compound {
                let rules = match component {
                    Component::PseudoElement(pseudo_element) => {
                        Some(self.check_pseudo_element(pseudo_element, context)?)
                    }
                    Component::Part(_) => Some(PseudoElementRules {
                        followed_by: FollowedBy::PartState,
                        is_tree_abiding: false,
                    }),
                    Component::Slotted(selector) => {
                        self.emit_complex(selector, context, false)?;
                        Some(PseudoElementRules {
                            followed_by: FollowedBy::TreeAbidingPseudoElements,
                            is_tree_abiding: false,
                        })
                    }
                    _ => None,
                };

                let is_allowed = match followed_by {
                    None => true,
                    Some(FollowedBy::Nothing) => false,
                    Some(FollowedBy::UserActionPseudoClasses) => matches!(
                        component,
                        Component::NonTsPseudoClass(pseudo_class)
                            if pseudo_class.is_user_action_state()
                    ),
                    Some(FollowedBy::ScrollbarPseudoClasses) => matches!(
                        component,
                        Component::NonTsPseudoClass(pseudo_class)
                            if pseudo_class.is_valid_after_webkit_scrollbar()
                    ),
                    Some(FollowedBy::OnlyChild) => matches!(
                        component,
                        Component::Nth(data) if data.ty == NthType::OnlyChild
                    ),
                    Some(FollowedBy::PartState) => {
                        matches!(component, Component::PseudoElement(_))
                            || self.is_valid_after_part(component)
                    }
                    Some(FollowedBy::TreeAbidingPseudoElements) => {
                        rules.is_some_and(|rules| rules.is_tree_abiding)
                    }
                };
                if !is_allowed {
                    return Err(Invalid);
                }

                if let Some(rules) = rules {
                    followed_by = Some(rules.followed_by);
                }
            }

            if start == 0 {
                return Ok(());
            }
            let Component::Combinator(combinator) = &components[start - 1] else {
                return Err(Invalid);
            };
            match combinator {
                // The parser puts these to the left of a pseudo-element. Nothing is written there.
                Combinator::PseudoElement | Combinator::SlotAssignment | Combinator::Part => {}
                Combinator::Child
                | Combinator::Descendant
                | Combinator::NextSibling
                | Combinator::LaterSibling => {
                    if followed_by.is_some() {
                        return Err(Invalid);
                    }
                }
                Combinator::DeepDescendant | Combinator::Deep => return Err(Invalid),
            }
            end = start - 1;
        }
    }

    fn check_pseudo_element(
        &mut self,
        pseudo_element: &PseudoElement,
        context: Context,
    ) -> Result<PseudoElementRules, Invalid> {
        use FollowedBy as F;
        use PseudoElement as P;

        let (followed_by, is_tree_abiding) = match pseudo_element {
            P::Before | P::After | P::Marker | P::PickerIcon => (F::Nothing, true),
            P::FirstLine | P::FirstLetter | P::Checkmark | P::ViewTransition => (F::Nothing, false),
            P::Selection(prefix) if *prefix == VendorPrefix::NONE => (F::Nothing, false),
            P::Backdrop(prefix) if *prefix == VendorPrefix::NONE => (F::Nothing, true),
            P::Placeholder(prefix) | P::FileSelectorButton(prefix)
                if *prefix == VendorPrefix::NONE =>
            {
                (F::UserActionPseudoClasses, true)
            }
            P::Placeholder(prefix) | P::FileSelectorButton(prefix) | P::Backdrop(prefix)
                if *prefix == VendorPrefix::WEBKIT =>
            {
                (F::UserActionPseudoClasses, false)
            }
            P::DetailsContent => (F::UserActionPseudoClasses, true),
            P::Cue => (F::UserActionPseudoClasses, false),
            P::CueFunction { selector } => {
                if selector.has_combinator() {
                    return Err(Invalid);
                }
                self.emit_complex(selector, context, false)?;
                (F::Nothing, false)
            }
            P::PickerFunction { identifier }
                if strings::eql_case_insensitive_ascii_check_length(identifier.v(), b"select") =>
            {
                (F::UserActionPseudoClasses, true)
            }
            P::WebkitScrollbar(_) => (F::ScrollbarPseudoClasses, false),
            P::ViewTransitionGroup { .. }
            | P::ViewTransitionImagePair { .. }
            | P::ViewTransitionOld { .. }
            | P::ViewTransitionNew { .. } => (F::OnlyChild, false),
            // Browsers take any name with this prefix, for compatibility, but do not say they support it.
            P::Custom { name } if has_webkit_prefix(name) && !self.is_for_supports => {
                (F::UserActionPseudoClasses, false)
            }
            P::Custom { name }
                if strings::eql_case_insensitive_ascii_check_length(name, b"target-text") =>
            {
                (F::Nothing, false)
            }
            P::CustomFunction { name, arguments }
                if strings::eql_case_insensitive_ascii_check_length(name, b"highlight")
                    && is_one_ident(arguments) =>
            {
                (F::Nothing, false)
            }

            // Prefixes of other engines.
            P::Selection(_) | P::Backdrop(_) | P::Placeholder(_) | P::FileSelectorButton(_) => {
                return Err(Invalid);
            }
            // No browser, or only one, has these.
            P::CueRegion
            | P::CueRegionFunction { .. }
            | P::ViewTransitionGroupChildren { .. }
            | P::PickerFunction { .. } => return Err(Invalid),
            // Names the parser does not know.
            P::Custom { .. } | P::CustomFunction { .. } => return Err(Invalid),
        };
        Ok(PseudoElementRules {
            followed_by,
            is_tree_abiding,
        })
    }
}

fn relation_for(combinator: Combinator) -> Result<Relation, Invalid> {
    match combinator {
        Combinator::Descendant => Ok(Relation::Descendant),
        Combinator::Child => Ok(Relation::Child),
        Combinator::NextSibling => Ok(Relation::DirectAdjacent),
        Combinator::LaterSibling => Ok(Relation::IndirectAdjacent),
        Combinator::PseudoElement
        | Combinator::SlotAssignment
        | Combinator::Part
        | Combinator::DeepDescendant
        | Combinator::Deep => Err(Invalid),
    }
}

fn nth_op(data: NthSelectorData) -> Result<SelectorOp, Invalid> {
    use PseudoClassKind as K;

    let kind = match (data.ty, data.is_function) {
        (NthType::Child, false) => K::FirstChild,
        (NthType::LastChild, false) => K::LastChild,
        (NthType::OnlyChild, false) => K::OnlyChild,
        (NthType::OfType, false) => K::FirstOfType,
        (NthType::LastOfType, false) => K::LastOfType,
        (NthType::OnlyOfType, false) => K::OnlyOfType,
        (NthType::Child, true) => K::NthChild,
        (NthType::LastChild, true) => K::NthLastChild,
        (NthType::OfType, true) => K::NthOfType,
        (NthType::LastOfType, true) => K::NthLastOfType,
        (NthType::OnlyChild | NthType::OnlyOfType, true) => return Err(Invalid),
        // No browser has `:nth-col()`.
        (NthType::Col | NthType::LastCol, _) => return Err(Invalid),
    };
    Ok(SelectorOp {
        a: data.a,
        b: data.b,
        ..SelectorOp::pseudo_class(kind)
    })
}

fn attribute_kind(operator: attrs::AttrSelectorOperator) -> OpKind {
    match operator {
        attrs::AttrSelectorOperator::Equal => OpKind::AttributeExact,
        attrs::AttrSelectorOperator::Includes => OpKind::AttributeList,
        attrs::AttrSelectorOperator::DashMatch => OpKind::AttributeHyphen,
        attrs::AttrSelectorOperator::Prefix => OpKind::AttributeBegin,
        attrs::AttrSelectorOperator::Substring => OpKind::AttributeContain,
        attrs::AttrSelectorOperator::Suffix => OpKind::AttributeEnd,
    }
}

fn attribute_case(case_sensitivity: attrs::ParsedCaseSensitivity) -> AttributeCase {
    match case_sensitivity {
        attrs::ParsedCaseSensitivity::ExplicitCaseSensitive
        | attrs::ParsedCaseSensitivity::CaseSensitive => AttributeCase::Sensitive,
        attrs::ParsedCaseSensitivity::AsciiCaseInsensitive => AttributeCase::Insensitive,
        attrs::ParsedCaseSensitivity::AsciiCaseInsensitiveIfInHtmlElementInHtmlDocument => {
            AttributeCase::InsensitiveInHtml
        }
    }
}

/// An id or a class. It is a symbol reference only with CSS modules, which are off here.
fn plain_ident(ident: IdentOrRef) -> Result<&'static [u8], Invalid> {
    let ident = ident.as_ident().ok_or(Invalid)?;
    // SAFETY: the name lives in the input or the arena, like every string of the AST.
    Ok(unsafe { crate::arena_str(ident.v) })
}

fn is_pseudo_element(component: &Component) -> bool {
    matches!(
        component,
        Component::PseudoElement(_) | Component::Slotted(_) | Component::Part(_)
    )
}

fn is_unprefixed_or_webkit(prefix: VendorPrefix) -> bool {
    prefix == VendorPrefix::NONE || prefix == VendorPrefix::WEBKIT
}

fn has_webkit_prefix(name: &[u8]) -> bool {
    const PREFIX: &[u8] = b"-webkit-";
    name.len() >= PREFIX.len()
        && strings::eql_case_insensitive_ascii_check_length(&name[..PREFIX.len()], PREFIX)
}

/// At least one `<custom-ident>`, with commas in between.
fn is_custom_ident_list(arguments: &TokenList) -> bool {
    let mut expects_ident = true;
    for token in &arguments.v {
        match token {
            TokenOrValue::Token(Token::Whitespace(_)) => {}
            TokenOrValue::Token(Token::Ident(name))
                if expects_ident && !is_reserved_custom_ident(name) =>
            {
                expects_ident = false;
            }
            TokenOrValue::Token(Token::Comma) if !expects_ident => expects_ident = true,
            _ => return false,
        }
    }
    !expects_ident
}

/// One identifier, with or without white space around it.
fn is_one_ident(arguments: &TokenList) -> bool {
    let mut tokens = arguments
        .v
        .iter()
        .filter(|token| !matches!(token, TokenOrValue::Token(Token::Whitespace(_))));
    matches!(tokens.next(), Some(TokenOrValue::Token(Token::Ident(_)))) && tokens.next().is_none()
}
