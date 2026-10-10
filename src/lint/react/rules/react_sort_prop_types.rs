use crate::util_ast::{Property, get_key_value, get_property_name_node};
use crate::util_is_create_element::is_member_called;
use crate::util_prop_wrapper::is_prop_wrapper_function;
use crate::util_props::{is_prop_types_declaration, is_required_prop_type};
use crate::util_variable::{Found, find_variable_by_name};
use bun_core::fmt::js_string_to_number;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::cell::OnceCell;
use std::cmp::Ordering;

/// Enforce propTypes declarations alphabetical sorting
pub struct SortPropTypes {
    required_first: bool,
    callbacks_last: bool,
    ignore_case: bool,
    no_sort_alphabetically: bool,
    sort_shape_prop: bool,
    check_types: bool,
}

const REQUIRED_PROPS_FIRST: Message =
    Message::new("requiredPropsFirst", "Required prop types must be listed before all other prop types");
const CALLBACK_PROPS_LAST: Message =
    Message::new("callbackPropsLast", "Callback prop types must be listed after all other prop types");
const PROPS_NOT_SORTED: Message =
    Message::new("propsNotSorted", "Prop types declarations should be sorted alphabetically");

#[derive(Default)]
pub struct State<'a> {
    /// `typeAnnotations`: by its name the first `type A = { .. }` of the file.
    type_annotations: OnceCell<FxHashMap<Name<'a>, Stmt<'a>>>,
}

/// The `properties` of an object literal, or the `members` of a type literal.
#[derive(Copy, Clone)]
enum Declarations<'a> {
    Properties(List<'a, Prop<'a>>),
    Members(List<'a, Member<'a>>),
}

/// What `getKey` returns.
struct PropName<'a> {
    /// `String(propName)`
    string: Cow<'a, [u8]>,
    /// What `<` makes of it, if it is no string.
    number: Option<f64>,
}

/// `prev` or `curr` of `checkSorted`.
struct Checked<'a> {
    node: Property<'a>,
    /// In lower case with `ignoreCase`.
    name: PropName<'a>,
    is_required: bool,
    is_callback: bool,
    /// `callbackPropsLastSeen`
    is_reported: bool,
}

/// A declaration that is no spread, for `sortInSource`.
struct Sortable<'a> {
    node: Property<'a>,
    /// How many spreads are before it.
    group: u32,
    /// What `sorter` looks at before the keys: `false` comes first.
    rank: [bool; 2],
    /// `String(getKeyValue(node))`
    key: Cow<'a, [u8]>,
    /// What `commentnodeMap` has: from the first comment before it to the last one after it ..
    range: Span,
    /// .. and the same in UTF-16 code units, from where the text starts that is sorted.
    units: Span,
}

/// `sortedAttrTextVal`
struct Moved<'a> {
    sorted_attr_text: Cow<'a, [u8]>,
    /// Empty where none is added.
    separator: &'a [u8],
}

#[derive(Copy, Clone)]
enum Piece<'t> {
    /// With its `length`.
    Text(&'t [u8], u32),
    /// Half of a surrogate pair that an index was in.
    Surrogate(u16),
}

/// A text that is cut and put together again at indices of JavaScript, as upstream does it with `slice` and `+`: also
/// where an index is no longer at what it was computed for. It is kept in pieces around the place of the last change.
struct Source<'t> {
    before: Vec<Piece<'t>>,
    /// The `length` of `before`.
    at: u32,
    /// The nearest last.
    after: Vec<Piece<'t>>,
    /// What is after `after`: nothing has looked at it yet.
    rest: &'t [u8],
}

impl Rule for SortPropTypes {
    const META: Meta = Meta::plugin(Plugin::React, "sort-prop-types", Kind::None).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::Dot, ExprTag::Index]).funcs().members().props();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let configuration = options.object(0);
        SortPropTypes {
            required_first: configuration.bool_or("requiredFirst", false),
            callbacks_last: configuration.bool_or("callbacksLast", false),
            ignore_case: configuration.bool_or("ignoreCase", false),
            no_sort_alphabetically: configuration.bool_or("noSortAlphabetically", false),
            sort_shape_prop: configuration.bool_or("sortShapeProp", false),
            check_types: configuration.bool_or("checkTypes", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if file.mentions_any(&["propTypes", "#propTypes"]) {
            on = on.exprs(&[ExprTag::Dot, ExprTag::Index]).members().props();
        } else if file.mentions_any(&["props", "#props"]) {
            on = on.members();
        }
        if self.sort_shape_prop && file.mentions_any(&["shape", "#shape"]) {
            on = on.exprs(&[ExprTag::Call]);
        }
        if self.check_types { on.funcs() } else { on }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Call(call) = e.kind() {
            if is_member_called(call.callee(), "shape")
                && let Some(first_arg) = call.args().first()
            {
                self.check_properties(first_arg, cx);
            }
        } else if is_member_called(e, "propTypes")
            && let Some(right) = right_of_parent(e)
        {
            self.check_node(right, cx);
        }
    }

    /// `handleFunctionComponent`
    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !matches!(func.kind(), FnKind::Decl | FnKind::Arrow) || !func.has_body() {
            return;
        }
        // The annotation of a parameter with a default value is that of the `left` of an `AssignmentPattern`.
        let first = func.params_with_this().next().filter(|it| it.default().is_none());
        let Some(first_arg) = first.and_then(Param::ty) else {
            return;
        };
        let prop_type = match first_arg.kind() {
            TypeKind::Ref { name, .. } => {
                let Some(name) = name.as_ident() else {
                    return;
                };
                let known = cx.state.type_annotations.get_or_init(|| type_annotations(cx.file()));
                // What the walk has come to before the function.
                match known.get(&name.name()).map(|it| (it.span().start, it.kind())) {
                    Some((start, StmtKind::TypeAlias(alias))) if start < func.estree_span().start => alias.ty(),
                    _ => return,
                }
            }
            _ => first_arg,
        };
        if let TypeKind::Object(members) = prop_type.kind() {
            self.check_sorted(Declarations::Members(members), cx);
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if ast_utils::is_property_definition(member)
            && is_prop_types_declaration(Node::Member(member))
            && let Some(value) = member.init()
        {
            self.check_node(value, cx);
        }
    }

    fn prop<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if is_prop_types_declaration(Node::Prop(property))
            && let Some(value) = property.value()
            && let Some(declarations) = Declarations::of(value)
            && !value.is_assignment_target()
        {
            self.check_sorted(declarations, cx);
        }
    }
}

impl SortPropTypes {
    /// `checkNode`
    fn check_node<'a>(&self, mut node: Expr<'a>, cx: &Cx<'a, Self>) {
        while let ExprKind::Call(call) = node.kind()
            && !node.is_chain_root()
            && call.callee().as_ident().is_some_and(|name| is_prop_wrapper_function(cx.file(), name.bytes()))
            && let Some(inner_node) = call.args().first()
        {
            node = inner_node;
        }
        self.check_properties(node, cx);
    }

    /// An object literal, or a variable that is one.
    fn check_properties<'a>(&self, node: Expr<'a>, cx: &Cx<'a, Self>) {
        let object = match node.as_ident().map(|name| find_variable_by_name(Node::Expr(node), name)) {
            Some(Some(Found::Init(init))) => init,
            Some(_) => return,
            None => node,
        };
        if let Some(declarations) = Declarations::of(object) {
            self.check_sorted(declarations, cx);
        }
    }

    /// `checkSorted`
    fn check_sorted<'a>(&self, declarations: Declarations<'a>, cx: &Cx<'a, Self>) {
        let fix = OnceCell::new();
        let report = |node: Property<'a>, message: Message| {
            cx.report(node.node(), message)
                .fix(|fixer| fix.get_or_init(|| self.fix_prop_types_sort(fixer, declarations)).clone());
        };
        let mut prev: Option<Checked<'a>> = None;
        for node in declarations.iter() {
            // After a spread the next one is compared with itself.
            if Declarations::is_spread(node) {
                prev = None;
                continue;
            }
            let curr = Checked::new(node, self);
            let Some(mut previous) = prev.take() else {
                prev = Some(curr);
                continue;
            };
            prev = Some(match (previous.is_required, curr.is_required, previous.is_callback, curr.is_callback) {
                (true, false, ..) => curr,
                (false, true, ..) => {
                    report(node, REQUIRED_PROPS_FIRST);
                    curr
                }
                (_, _, false, true) => curr,
                (_, _, true, false) => {
                    if !std::mem::replace(&mut previous.is_reported, true) {
                        report(previous.node, CALLBACK_PROPS_LAST);
                    }
                    previous
                }
                _ if !self.no_sort_alphabetically && curr.name.is_less_than(&previous.name) => {
                    report(node, PROPS_NOT_SORTED);
                    previous
                }
                _ => curr,
            });
        }
    }

    /// `fixPropTypesSort`: the same for all reports in the list.
    #[cold]
    #[inline(never)]
    fn fix_prop_types_sort<'a>(&self, fixer: Fixer<'a>, declarations: Declarations<'a>) -> Option<Fix> {
        let file = fixer.file();
        let (first, last) = (declarations.iter().next()?, declarations.iter().next_back()?);
        let whole = with_comments(file, first.node().span()).to(with_comments(file, last.node().span()));
        Some(fixer.replace(whole, self.sort_in_source(file, declarations, whole)))
    }

    /// `sortInSource(allNodes, originalSource).slice(whole.start, whole.end)`. Nothing is changed before `whole`.
    fn sort_in_source<'a>(&self, file: &'a File<'a>, all_nodes: Declarations<'a>, whole: Span) -> Vec<u8> {
        // The `length` of what is from the start of `whole` to an offset, counted from the offset that was asked last.
        let (mut known, mut length) = (whole.start, 0u32);
        let mut units_until = |offset: u32| {
            length = match offset >= known {
                true => length + strings::wtf8_len_utf16(file.slice(Span::new(known, offset))),
                false => length.saturating_sub(strings::wtf8_len_utf16(file.slice(Span::new(offset, known)))),
            };
            known = offset;
            length
        };
        let (mut sortable, mut group) = (Vec::new(), 0);
        for node in all_nodes.iter() {
            if Declarations::is_spread(node) {
                group += 1;
                continue;
            }
            let key = get_key_value(node.node()).unwrap_or(Cow::Borrowed(b"undefined"));
            let is_optional = self.required_first && !node.value().is_some_and(is_required_prop_type);
            let rank = [is_optional, self.callbacks_last && is_callback_prop_name(&key)];
            let range = with_comments(file, node.node().span());
            let units = Span::new(units_until(range.start), units_until(range.end));
            sortable.push(Sortable { node, group, rank, key, range, units });
        }
        let mut sorted_attributes: Vec<&Sortable<'a>> = sortable.iter().collect();
        // `sorter`
        utils::sort::sort_by(&mut sorted_attributes, |a, b| match (a.group, a.rank).cmp(&(b.group, b.rank)) {
            Ordering::Equal if self.no_sort_alphabetically => Ordering::Equal,
            Ordering::Equal if self.ignore_case => strings::locale_compare(&a.key, &b.key),
            Ordering::Equal => strings::order_utf16(&a.key, &b.key),
            by_rank => by_rank,
        });
        // From the last to the first, as upstream: the first `;` or `,` that one of a group ends with is for the rest.
        let mut moved = Vec::with_capacity(sortable.len());
        let (mut separator, mut group): (&[u8], _) = (b"", None);
        for sorted_attr in sorted_attributes.iter().rev() {
            if group != Some(sorted_attr.group) {
                separator = b"";
                group = Some(sorted_attr.group);
            }
            let with_its_comments = file.slice(sorted_attr.range);
            if separator.is_empty()
                && let Some(last_char @ (b";" | b",")) = with_its_comments.last_chunk::<1>()
            {
                separator = last_char;
            }
            let shape = sorted_attr.node.value().filter(|_| self.sort_shape_prop).and_then(get_shape_properties);
            // The comments are lost here.
            let sorted_attr_text = match shape {
                Some(shape) => Cow::Owned(self.sort_in_source(file, shape, sorted_attr.node.node().span())),
                None => Cow::Borrowed(with_its_comments),
            };
            let is_added = self.check_types && !sorted_attr_text.ends_with(separator);
            moved.push(Moved { sorted_attr_text, separator: if is_added { separator } else { &[] } });
        }
        let places: Vec<(&Sortable<'a>, Moved<'a>)> = sortable.iter().zip(moved.into_iter().rev()).collect();
        let mut source = Source::new(file.text().get(whole.start as usize..).unwrap_or_default());
        for nodes in places.chunk_by(|a, b| a.0.group == b.0.group) {
            // So that it is cut once at each place, going forward.
            for (attr, _) in nodes {
                source.move_to(attr.units.start);
                source.move_to(attr.units.end);
            }
            for (attr, text_val) in nodes.iter().rev() {
                source.move_to(attr.units.start);
                source.remove(attr.units.len());
                source.insert(text_val.separator);
                source.insert(&text_val.sorted_attr_text);
            }
        }
        source.move_to(units_until(whole.end));
        let mut sorted = Vec::new();
        for piece in &source.before {
            match *piece {
                Piece::Text(bytes, _) => sorted.extend_from_slice(bytes),
                Piece::Surrogate(half) => strings::push_codepoint_wtf8_joined(&mut sorted, u32::from(half)),
            }
        }
        sorted
    }
}

/// `typeAnnotations`, when the walk is over.
fn type_annotations<'a>(file: &'a File<'a>) -> FxHashMap<Name<'a>, Stmt<'a>> {
    let mut first: FxHashMap<Name<'a>, Stmt<'a>> = FxHashMap::default();
    for statement in file.stmts_of_kind(StmtTag::TypeAlias) {
        let StmtKind::TypeAlias(alias) = statement.kind() else {
            continue;
        };
        if alias.ty().tag() != TypeTag::Object {
            continue;
        }
        let known = first.entry(alias.name().name()).or_insert(statement);
        if statement.span().start < known.span().start {
            *known = statement;
        }
    }
    first
}

/// `node.parent.right`, for a `node` that is not the whole of an optional chain.
fn right_of_parent(node: Expr<'_>) -> Option<Expr<'_>> {
    match node.parent() {
        Node::Expr(parent) if !matches!(parent.kind(), ExprKind::Binary { op: BinOp::Comma, .. }) => parent.right(),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => Some(expr),
            _ => None,
        },
        _ => None,
    }
}

/// `isCallbackPropName`
fn is_callback_prop_name(prop_name: &[u8]) -> bool {
    matches!(prop_name, [b'o', b'n', b'A'..=b'Z', ..])
}

/// `isShapeProp(node) && getShapeProperties(node)`
fn get_shape_properties(node: Expr<'_>) -> Option<Declarations<'_>> {
    let call = match node.kind() {
        ExprKind::Call(call) if !node.is_chain_root() => call,
        ExprKind::New(call) => call,
        _ => return None,
    };
    is_member_called(call.callee(), "shape").then(|| call.args().first().and_then(Declarations::of))?
}

/// What `commentnodeMap` has for `node`.
fn with_comments<'a>(file: &'a File<'a>, node: Span) -> Span {
    let new_start = file.comments_before(node).next().map_or(node.start, |it| it.start());
    let new_end = file.comments_after(node).next_back().map_or(node.end, |it| it.end());
    Span::new(new_start, new_end)
}

impl<'a> Declarations<'a> {
    /// `node.properties`
    fn of(node: Expr<'a>) -> Option<Declarations<'a>> {
        match node.kind() {
            ExprKind::Object(properties) => Some(Declarations::Properties(properties)),
            _ => None,
        }
    }

    fn iter(self) -> impl DoubleEndedIterator<Item = Property<'a>> {
        let (properties, members) = match self {
            Declarations::Properties(it) => (Some(it), None),
            Declarations::Members(it) => (None, Some(it)),
        };
        let properties = properties.into_iter().flatten().map(Property::Prop);
        properties.chain(members.into_iter().flatten().map(Property::Member))
    }

    fn is_spread(node: Property<'_>) -> bool {
        matches!(node, Property::Prop(it) if it.kind() == PropKind::Spread)
    }
}

impl<'a> PropName<'a> {
    /// `getKey`
    fn new(node: Property<'a>) -> PropName<'a> {
        let file = node.node().file();
        let number_of = |string: &[u8]| Some(js_string_to_number(string));
        // `node.key.value`
        let value = node.key().and_then(|key| {
            let (string, number) = match key.kind() {
                KeyKind::String(value) => (Cow::Borrowed(value.bytes()), None),
                // A `TemplateLiteral` has none.
                KeyKind::ComputedString(value) if !file.slice(key.inner_span(file)).starts_with(b"`") => {
                    (Cow::Borrowed(value.bytes()), None)
                }
                KeyKind::Number(value) | KeyKind::ComputedNumber(value) => {
                    (Cow::Borrowed(value.bytes()), number_of(value.bytes()))
                }
                KeyKind::Computed(e) => {
                    let string = ast_utils::get_static_string_value(e)?;
                    let number = match e.tag() {
                        ExprTag::String | ExprTag::Regex => None,
                        ExprTag::Number | ExprTag::BigInt => number_of(&string),
                        ExprTag::True => Some(1.0),
                        _ => return None,
                    };
                    (string, number)
                }
                _ => return None,
            };
            (!string.is_empty() && number != Some(0.0)).then_some(PropName { string, number })
        });
        // The text of nothing is the whole text.
        value.unwrap_or_else(|| {
            let key = get_property_name_node(node.node());
            PropName { string: Cow::Borrowed(key.map_or_else(|| file.text(), |it| file.slice(it))), number: None }
        })
    }

    /// `String(propName).toLowerCase()`
    fn into_lower_case(self) -> PropName<'a> {
        let string = match self.string {
            Cow::Borrowed(string) => text::to_lower_case(string),
            Cow::Owned(string) => Cow::Owned(text::to_lower_case(&string).into_owned()),
        };
        PropName { string, number: None }
    }

    /// `self < other`. A BigInt counts as a number.
    fn is_less_than(&self, other: &PropName<'a>) -> bool {
        let to_number = |it: &PropName<'a>| it.number.unwrap_or_else(|| js_string_to_number(&it.string));
        match (self.number, other.number) {
            (None, None) => strings::order_utf16(&self.string, &other.string) == Ordering::Less,
            _ => to_number(self) < to_number(other),
        }
    }
}

impl<'a> Checked<'a> {
    fn new(node: Property<'a>, rule: &SortPropTypes) -> Checked<'a> {
        let name = PropName::new(node);
        Checked {
            node,
            is_required: rule.required_first && node.value().is_some_and(is_required_prop_type),
            is_callback: rule.callbacks_last && is_callback_prop_name(&name.string),
            name: if rule.ignore_case { name.into_lower_case() } else { name },
            is_reported: false,
        }
    }
}

impl Piece<'_> {
    fn units(self) -> u32 {
        match self {
            Piece::Text(_, units) => units,
            Piece::Surrogate(_) => 1,
        }
    }
}

impl<'t> Source<'t> {
    fn new(rest: &'t [u8]) -> Source<'t> {
        Source { before: Vec::new(), at: 0, after: Vec::new(), rest }
    }

    /// Takes a piece of at most `units` code units from what is after the place. `None`: the text ends here.
    fn take(&mut self, units: u32) -> Option<Piece<'t>> {
        let (bytes, length) = match self.after.pop() {
            Some(Piece::Text(bytes, length)) if length > units => (bytes, Some(length)),
            Some(piece) => return Some(piece),
            None if self.rest.is_empty() => return None,
            None => (std::mem::take(&mut self.rest), None),
        };
        let (taken, mut others) = bytes.split_at(strings::wtf8_offset_of_utf16_index(bytes, units));
        let mut taken_units = strings::wtf8_len_utf16(taken);
        let pair = match strings::wtf8_codepoint_at(others, 0) {
            (pair @ 0x1_0000..=0x10_FFFF, size) if taken_units < units => {
                others = others.get(size..).unwrap_or_default();
                Some(strings::encode_surrogate_pair(pair))
            }
            _ => None,
        };
        let taken = Piece::Text(taken, taken_units);
        taken_units += if pair.is_some() { 2 } else { 0 };
        match length {
            Some(length) => self.after.push(Piece::Text(others, length.saturating_sub(taken_units))),
            None => self.rest = others,
        }
        self.after.extend(pair.into_iter().flatten().rev().map(Piece::Surrogate));
        Some(taken)
    }

    /// To the index `to`, or to the end of the text.
    fn move_to(&mut self, to: u32) {
        while self.at > to
            && let Some(piece) = self.before.pop()
        {
            self.at -= piece.units();
            self.after.push(piece);
        }
        while self.at < to
            && let Some(piece) = self.take(to - self.at)
        {
            self.at += piece.units();
            self.before.push(piece);
        }
    }

    /// What is after the place loses its first `units` code units.
    fn remove(&mut self, mut units: u32) {
        while units > 0
            && let Some(piece) = self.take(units)
        {
            units -= piece.units();
        }
    }

    /// `bytes` comes after the place.
    fn insert(&mut self, bytes: &'t [u8]) {
        self.after.push(Piece::Text(bytes, strings::wtf8_len_utf16(bytes)));
    }
}
