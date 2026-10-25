use bun_core::strings;
use bun_sema::atom::Atom;
use bun_sema::hir::{ExprId, ExprKind, File, PropKey, PropKind, UnOp};
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

use super::ValidatedFile;
use crate::ir::generated::{
    TextFormat, UndeclaredMembers, ValidatedPrimitive, ValidationMember, ValidationNode,
    ValidationRule, ValidationShape,
};

const MAX_STEPS_AT_ONE_VALUE: u32 = 64;
const MAX_STEPS_OF_ONE_PROOF: u32 = 1 << 20;
const MAX_SCHEMAS_AT_ONE_VALUE: usize = 64;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Draft {
    Draft7,
    Draft2020,
}

/// JSON text holds no `undefined`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Source {
    Text,
    Value,
}

pub(super) struct WrittenSchema<'p, 's> {
    pub(super) hir: &'p File<'s>,
    pub(super) schema: ExprId,
    pub(super) options: Option<(&'p File<'s>, ExprId)>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Reason {
    IsNotWrittenOut,
    IsMalformed,
    IsNotKnown,
    IsEmpty,
    IsOfAnotherDraft,
    LacksItsPartner,
    StandsBesideReference,
    IsNotCompiled,
    IsTooLarge,
    TypeFillsDefault,
    TypeAcceptsWhatIsNotJson,
    TypeAcceptsMore,
    TypeRefusesMore,
}

impl Reason {
    pub(super) fn text(self) -> &'static [u8] {
        match self {
            Reason::IsNotWrittenOut => b"it is not written out as a literal",
            Reason::IsMalformed => b"its value is not of the kind that the keyword takes",
            Reason::IsNotKnown => b"it is not known",
            Reason::IsEmpty => b"the list is empty",
            Reason::IsOfAnotherDraft => b"it belongs to another draft",
            Reason::LacksItsPartner => b"the keyword that it goes with is missing",
            Reason::StandsBesideReference => b"draft-07 ignores what stands beside $ref",
            Reason::IsNotCompiled => b"no code is generated for it yet",
            Reason::IsTooLarge => b"the comparison of schema and type takes too many steps",
            Reason::TypeFillsDefault => {
                b"the type fills in a value with Schema.Default, and a schema fills in none"
            }
            Reason::TypeAcceptsWhatIsNotJson => {
                b"the type accepts what no JSON value is, such as undefined"
            }
            Reason::TypeAcceptsMore => b"the type may accept a value that it refuses",
            Reason::TypeRefusesMore => b"the type may refuse a value that it accepts",
        }
    }

    // A search among arms leaves the others behind wherever an arm does not fit.
    fn is_about_the_schema_alone(self) -> bool {
        !matches!(
            self,
            Reason::TypeAcceptsWhatIsNotJson | Reason::TypeAcceptsMore | Reason::TypeRefusesMore
        )
    }
}

/// Why schema and nodes are not known to accept the same values.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct NoProof {
    pub(super) keyword: Vec<u8>,
    /// A JSON pointer into the schema, or "options".
    pub(super) place: Vec<u8>,
    pub(super) reason: Reason,
}

impl NoProof {
    /// `"minProperties" at #/properties/tags: the type may accept a value that it refuses`
    pub(super) fn describe(&self) -> Vec<u8> {
        let mut text = b"\"".to_vec();
        text.extend_from_slice(&self.keyword);
        text.extend_from_slice(b"\" at ");
        text.extend_from_slice(&self.place);
        text.extend_from_slice(b": ");
        text.extend_from_slice(self.reason.text());
        text
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Class {
    Null,
    Boolean,
    Number,
    String,
    Array,
    Object,
}

#[derive(Copy, Clone, PartialEq)]
enum Literal {
    Null,
    Boolean(bool),
    Number(f64),
    String(Atom),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Direction {
    /// What the node accepts is valid.
    Holds,
    /// What is valid, the node accepts.
    Takes,
}

type Properties = SmallVec<[(Atom, ExprId); 8]>;

/// Whether every value that the nodes accept is valid under the JSON Schema that the expression writes out.
pub(super) fn accepts_only_valid_values<'c, 'p: 'c, 's: 'p>(
    file: &mut impl ValidatedFile<'c, 'p, 's>,
    written: &WrittenSchema<'p, 's>,
    nodes: &[ValidationNode],
    source: Source,
) -> Result<(), NoProof> {
    prove(file, written, nodes, source, Direction::Holds)
}

/// Whether every value that the nodes refuse is invalid under the schema. Where nothing turns the answer of the nodes round, to refuse a value that no JSON text writes errs on the
/// safe side, and `Source::Text` is enough.
pub(super) fn refuses_only_invalid_values<'c, 'p: 'c, 's: 'p>(
    file: &mut impl ValidatedFile<'c, 'p, 's>,
    written: &WrittenSchema<'p, 's>,
    nodes: &[ValidationNode],
    source: Source,
) -> Result<(), NoProof> {
    prove(file, written, nodes, source, Direction::Takes)
}

fn prove<'c, 'p: 'c, 's: 'p>(
    file: &mut impl ValidatedFile<'c, 'p, 's>,
    written: &WrittenSchema<'p, 's>,
    nodes: &[ValidationNode],
    source: Source,
    direction: Direction,
) -> Result<(), NoProof> {
    let (hir, schema) = (written.hir, written.schema);
    // Where nothing is there, a node with such a rule accepts, and what comes back is not what came in.
    if nodes
        .iter()
        .any(|node| node.rules.iter().any(fills_default))
    {
        return Err(NoProof {
            keyword: b"default".to_vec(),
            place: b"#".to_vec(),
            reason: Reason::TypeFillsDefault,
        });
    }
    let options = read_options(file, written)?;
    let draft = find_draft(file, hir, schema, options.draft)?;
    let mut proof = Proof {
        file,
        hir,
        nodes,
        root: schema,
        draft,
        asserts_formats: options.asserts_formats,
        source,
        assumed: FxHashSet::default(),
        assumed_in_order: Vec::new(),
        enclosing: Vec::new(),
        open_alternatives: Vec::new(),
        class_at_hand: None,
        steps: 0,
        failure: None,
    };
    match proof.reads(schema) && proof.shows_below(direction, schema, 0) {
        true => Ok(()),
        false => Err(proof.describe_failure(direction)),
    }
}

struct Options {
    draft: Draft,
    asserts_formats: bool,
}

fn read_options<'c, 'p: 'c, 's: 'p>(
    file: &impl ValidatedFile<'c, 'p, 's>,
    written: &WrittenSchema<'_, '_>,
) -> Result<Options, NoProof> {
    let mut options = Options {
        draft: Draft::Draft2020,
        asserts_formats: true,
    };
    let Some((hir, expression)) = written.options else {
        return Ok(options);
    };
    let refuse = |keyword: &[u8], reason: Reason| NoProof {
        keyword: keyword.to_vec(),
        place: b"options".to_vec(),
        reason,
    };
    let Some(properties) = properties_of(hir, expression) else {
        return Err(refuse(b"options", Reason::IsNotWrittenOut));
    };
    for (name, value) in properties {
        let name = file.atom_bytes(name);
        if name == b"schemas" {
            return Err(refuse(name, Reason::IsNotCompiled));
        }
        let Some(literal) = literal_of(hir, value) else {
            return Err(refuse(name, Reason::IsNotWrittenOut));
        };
        match (name, literal) {
            (b"formats", Literal::Boolean(asserts)) => options.asserts_formats = asserts,
            // It decides whether the validator can be made, and nothing about one that was made: a keyword that is not known here ends the proof.
            (b"strict", Literal::Boolean(_)) => {}
            (b"draft", Literal::String(draft)) => {
                options.draft = match file.atom_bytes(draft) {
                    b"2020-12" => Draft::Draft2020,
                    b"draft-07" => Draft::Draft7,
                    _ => return Err(refuse(name, Reason::IsNotKnown)),
                };
            }
            _ => return Err(refuse(name, Reason::IsNotKnown)),
        }
    }
    Ok(options)
}

// `$schema` goes before the option.
fn find_draft<'c, 'p: 'c, 's: 'p>(
    file: &impl ValidatedFile<'c, 'p, 's>,
    hir: &File<'_>,
    root: ExprId,
    otherwise: Draft,
) -> Result<Draft, NoProof> {
    let Some(properties) = properties_of(hir, root) else {
        return Ok(otherwise);
    };
    let dialect = properties
        .iter()
        .find(|property| file.atom_bytes(property.0) == b"$schema");
    let Some(&(_, written)) = dialect else {
        return Ok(otherwise);
    };
    let refuse = |reason: Reason| NoProof {
        keyword: b"$schema".to_vec(),
        place: b"#/$schema".to_vec(),
        reason,
    };
    let Some(Literal::String(dialect)) = literal_of(hir, written) else {
        return Err(refuse(Reason::IsNotWrittenOut));
    };
    match file.atom_bytes(dialect) {
        b"https://json-schema.org/draft/2020-12/schema"
        | b"https://json-schema.org/draft/2020-12/schema#" => Ok(Draft::Draft2020),
        b"http://json-schema.org/draft-07/schema" | b"http://json-schema.org/draft-07/schema#" => {
            Ok(Draft::Draft7)
        }
        _ => Err(refuse(Reason::IsNotKnown)),
    }
}

fn is_without_meaning(keyword: &[u8]) -> bool {
    matches!(
        keyword,
        b"title"
            | b"description"
            | b"default"
            | b"examples"
            | b"$comment"
            | b"deprecated"
            | b"readOnly"
            | b"writeOnly"
            | b"contentEncoding"
            | b"contentMediaType"
            | b"contentSchema"
            | b"$defs"
            | b"definitions"
    ) || keyword.starts_with(b"x-")
}

fn format_named(name: &[u8]) -> Option<TextFormat> {
    Some(match name {
        b"date-time" => TextFormat::DateTime,
        b"date" => TextFormat::Date,
        b"time" => TextFormat::Time,
        b"duration" => TextFormat::Duration,
        b"email" => TextFormat::Email,
        b"hostname" => TextFormat::Hostname,
        b"ipv4" => TextFormat::Ipv4,
        b"ipv6" => TextFormat::Ipv6,
        b"uri" => TextFormat::Uri,
        b"uri-reference" => TextFormat::UriReference,
        b"uuid" => TextFormat::Uuid,
        b"regex" => TextFormat::Regex,
        b"json-pointer" => TextFormat::JsonPointer,
        b"relative-json-pointer" => TextFormat::RelativeJsonPointer,
        _ => return None,
    })
}

fn class_named(name: &[u8]) -> Option<Class> {
    Some(match name {
        b"null" => Class::Null,
        b"boolean" => Class::Boolean,
        b"number" | b"integer" => Class::Number,
        b"string" => Class::String,
        b"array" => Class::Array,
        b"object" => Class::Object,
        _ => return None,
    })
}

const ALL_CLASSES: [Class; 6] = [
    Class::Null,
    Class::Boolean,
    Class::Number,
    Class::String,
    Class::Array,
    Class::Object,
];

fn name_of(class: Class) -> &'static [u8] {
    match class {
        Class::Null => b"null",
        Class::Boolean => b"boolean",
        Class::Number => b"number",
        Class::String => b"string",
        Class::Array => b"array",
        Class::Object => b"object",
    }
}

fn keyword_of(rule: &ValidationRule) -> &'static [u8] {
    match rule {
        ValidationRule::Integer { .. } => b"type",
        ValidationRule::Minimum { .. } => b"minimum",
        ValidationRule::Maximum { .. } => b"maximum",
        ValidationRule::ExclusiveMinimum { .. } => b"exclusiveMinimum",
        ValidationRule::ExclusiveMaximum { .. } => b"exclusiveMaximum",
        ValidationRule::MultipleOf { .. } => b"multipleOf",
        ValidationRule::MinimumLength { .. } => b"minLength | minItems",
        ValidationRule::MaximumLength { .. } => b"maxLength | maxItems",
        ValidationRule::Pattern { .. } => b"pattern",
        ValidationRule::Format { .. } => b"format",
        ValidationRule::UniqueItems { .. } => b"uniqueItems",
        ValidationRule::Contains { .. } => b"contains",
        ValidationRule::Not { .. } => b"not",
        ValidationRule::If { .. } => b"if",
        ValidationRule::ExactlyOne { .. } => b"oneOf",
        ValidationRule::Every { .. } => b"allOf",
        ValidationRule::PatternMembers { .. } => b"patternProperties",
        ValidationRule::MemberNames { .. } => b"propertyNames",
        ValidationRule::MinimumMembers { .. } => b"minProperties",
        ValidationRule::MaximumMembers { .. } => b"maxProperties",
        ValidationRule::DependentMembers { .. } => b"dependentRequired",
        ValidationRule::DependentNode { .. } => b"dependentSchemas",
        ValidationRule::DefaultNull { .. }
        | ValidationRule::DefaultBoolean { .. }
        | ValidationRule::DefaultNumber { .. }
        | ValidationRule::DefaultString { .. } => b"default",
        // No keyword says them.
        ValidationRule::Template { .. } | ValidationRule::Message { .. } => b"type",
    }
}

fn fills_default(rule: &ValidationRule) -> bool {
    matches!(
        rule,
        ValidationRule::DefaultNull { .. }
            | ValidationRule::DefaultBoolean { .. }
            | ValidationRule::DefaultNumber { .. }
            | ValidationRule::DefaultString { .. }
    )
}

fn unescape_pointer_segment(segment: &[u8]) -> Option<Vec<u8>> {
    let mut name = Vec::with_capacity(segment.len());
    let mut bytes = segment.iter();
    while let Some(&byte) = bytes.next() {
        name.push(match byte {
            b'~' => match bytes.next()? {
                b'0' => b'~',
                b'1' => b'/',
                _ => return None,
            },
            _ => byte,
        });
    }
    Some(name)
}

fn index_of_pointer_segment(segment: &[u8]) -> Option<usize> {
    let is_plain =
        segment.iter().all(u8::is_ascii_digit) && (segment == b"0" || !segment.starts_with(b"0"));
    match is_plain {
        true => std::str::from_utf8(segment).ok()?.parse().ok(),
        false => None,
    }
}

fn write_pointer<'c, 'p: 'c, 's: 'p>(
    file: &impl ValidatedFile<'c, 'p, 's>,
    hir: &File<'_>,
    from: ExprId,
    wanted: ExprId,
    pointer: &mut Vec<u8>,
) -> bool {
    if hir.skip_type_assertions(from) == hir.skip_type_assertions(wanted) {
        return true;
    }
    let length = pointer.len();
    if let Some(elements) = elements_of(hir, from) {
        for (index, &element) in elements.iter().enumerate() {
            pointer.extend_from_slice(format!("/{index}").as_bytes());
            if write_pointer(file, hir, element, wanted, pointer) {
                return true;
            }
            pointer.truncate(length);
        }
    } else if let Some(properties) = properties_of(hir, from) {
        for &(key, value) in &properties {
            pointer.push(b'/');
            for &byte in file.atom_bytes(key) {
                match byte {
                    b'~' => pointer.extend_from_slice(b"~0"),
                    b'/' => pointer.extend_from_slice(b"~1"),
                    _ => pointer.push(byte),
                }
            }
            if write_pointer(file, hir, value, wanted, pointer) {
                return true;
            }
            pointer.truncate(length);
        }
    }
    false
}

fn literal_of(hir: &File<'_>, expression: ExprId) -> Option<Literal> {
    match hir[hir.skip_type_assertions(expression)].kind {
        ExprKind::Null => Some(Literal::Null),
        ExprKind::True => Some(Literal::Boolean(true)),
        ExprKind::False => Some(Literal::Boolean(false)),
        ExprKind::Number(number) => finite_literal(hir.numbers[number as usize]),
        ExprKind::String(text) => Some(Literal::String(text)),
        ExprKind::Unary {
            op: UnOp::Minus,
            operand,
        } => match hir[hir.skip_type_assertions(operand)].kind {
            ExprKind::Number(number) => finite_literal(-hir.numbers[number as usize]),
            _ => None,
        },
        _ => None,
    }
}

// `1e999` is Infinity, and so is `1e400`: what such a text means is not what the number says.
fn finite_literal(number: f64) -> Option<Literal> {
    number.is_finite().then_some(Literal::Number(number))
}

fn number_of(hir: &File<'_>, expression: ExprId) -> Option<f64> {
    match literal_of(hir, expression)? {
        Literal::Number(number) => Some(number),
        _ => None,
    }
}

fn count_of(hir: &File<'_>, expression: ExprId) -> Option<u32> {
    let number = number_of(hir, expression)?;
    let is_count = number.fract() == 0.0 && 0.0 <= number && number <= f64::from(u32::MAX);
    is_count.then_some(number as u32)
}

fn elements_of(hir: &File<'_>, expression: ExprId) -> Option<SmallVec<[ExprId; 8]>> {
    let ExprKind::Array(elements) = hir[hir.skip_type_assertions(expression)].kind else {
        return None;
    };
    let elements: SmallVec<[ExprId; 8]> = hir.ids(elements).collect();
    let is_value =
        |&element: &ExprId| !matches!(hir[element].kind, ExprKind::Spread(_) | ExprKind::Missing);
    elements.iter().all(is_value).then_some(elements)
}

fn properties_of(hir: &File<'_>, expression: ExprId) -> Option<Properties> {
    let ExprKind::Object(written) = hir[hir.skip_type_assertions(expression)].kind else {
        return None;
    };
    let mut properties = Properties::new();
    for property in written.iter() {
        let (PropKind::Init, PropKey::Name(key)) =
            (hir[property].kind, hir.runtime_property_key(property))
        else {
            return None;
        };
        if properties.iter().any(|known| known.0 == key) {
            return None;
        }
        properties.push((key, hir[property].value));
    }
    Some(properties)
}

#[derive(Copy, Clone)]
struct Failure<'p> {
    /// Empty: the name of the place.
    keyword: &'p [u8],
    at: ExprId,
    reason: Reason,
}

struct Proof<'f, 'n, 'p, 's, F> {
    file: &'f mut F,
    hir: &'p File<'s>,
    nodes: &'n [ValidationNode],
    root: ExprId,
    draft: Draft,
    asserts_formats: bool,
    source: Source,
    // A value is a finite tree, so a claim that is met again below itself holds if the rest does.
    assumed: FxHashSet<(ExprId, u32, Direction)>,
    assumed_in_order: Vec<(ExprId, u32, Direction)>,
    // Schemas that the value at hand is known to be valid under, besides the one that is asked about.
    enclosing: Vec<ExprId>,
    // The lists of `anyOf` | `oneOf` that are gone through for the value at hand: none is opened twice.
    open_alternatives: Vec<ExprId>,
    // What the value at hand is known to be, whichever schema and node are asked about.
    class_at_hand: Option<Class>,
    steps: u32,
    failure: Option<Failure<'p>>,
}

impl<'n, 'c, 'p: 'c, 's: 'p, F: ValidatedFile<'c, 'p, 's>> Proof<'_, 'n, 'p, 's, F> {
    fn text(&self, atom: Atom) -> &'p [u8] {
        self.file.atom_bytes(atom)
    }

    fn fail(&mut self, keyword: &'p [u8], at: ExprId, reason: Reason) -> bool {
        let replaces = match &self.failure {
            None => true,
            Some(known) => {
                reason.is_about_the_schema_alone() && !known.reason.is_about_the_schema_alone()
            }
        };
        if replaces {
            self.failure = Some(Failure {
                keyword,
                at,
                reason,
            });
        }
        false
    }

    fn describe_failure(&self, direction: Direction) -> NoProof {
        let failure = self.failure.unwrap_or(Failure {
            keyword: b"",
            at: self.root,
            reason: match direction {
                Direction::Holds => Reason::TypeAcceptsMore,
                Direction::Takes => Reason::TypeRefusesMore,
            },
        });
        let mut place = b"#".to_vec();
        if !write_pointer(&*self.file, self.hir, self.root, failure.at, &mut place) {
            place.truncate(1);
        }
        let keyword = match (failure.keyword, place.rsplit(|&byte| byte == b'/').next()) {
            (b"", Some(b"#") | None) => b"schema".to_vec(),
            (b"", Some(name)) => name.to_vec(),
            (keyword, _) => keyword.to_vec(),
        };
        NoProof {
            keyword,
            place,
            reason: failure.reason,
        }
    }

    fn spend(&mut self, schema: ExprId, steps: u32) -> bool {
        self.steps += 1;
        if steps > MAX_STEPS_AT_ONE_VALUE || self.steps > MAX_STEPS_OF_ONE_PROOF {
            return self.fail(b"", schema, Reason::IsTooLarge);
        }
        true
    }

    /// One way among several: what it assumed goes with it if it fails, and what it complained of if it does not.
    fn attempt(&mut self, shows: impl FnOnce(&mut Self) -> bool) -> bool {
        let known = self.assumed_in_order.len();
        let failure = self.failure;
        let is_shown = shows(self);
        match is_shown {
            true => self.failure = failure,
            false => self.forget_since(known),
        }
        is_shown
    }

    fn any_of<T: Copy>(&mut self, ways: &[T], mut shows: impl FnMut(&mut Self, T) -> bool) -> bool {
        self.attempt(|proof| {
            ways.iter()
                .any(|&way| proof.attempt(|proof| shows(proof, way)))
        })
    }

    fn rules_of(&self, node: u32) -> &'n [ValidationRule] {
        &self.nodes[node as usize].rules
    }

    fn any_rule(
        &mut self,
        node: u32,
        mut shows: impl FnMut(&mut Self, &'n ValidationRule) -> bool,
    ) -> bool {
        let rules = self.rules_of(node);
        self.attempt(|proof| {
            rules
                .iter()
                .any(|rule| proof.attempt(|proof| shows(proof, rule)))
        })
    }

    /// For a part of a value: an element, a member, a key.
    fn shows_below(&mut self, direction: Direction, schema: ExprId, node: u32) -> bool {
        let claim = (schema, node, direction);
        if !self.assumed.insert(claim) {
            return true;
        }
        let known = self.assumed_in_order.len();
        self.assumed_in_order.push(claim);
        let enclosing = std::mem::take(&mut self.enclosing);
        let open_alternatives = std::mem::take(&mut self.open_alternatives);
        let class_at_hand = self.class_at_hand.take();
        let is_shown = match direction {
            Direction::Holds => self.holds(schema, node, 0),
            Direction::Takes => self.takes(schema, node, 0),
        };
        self.enclosing = enclosing;
        self.open_alternatives = open_alternatives;
        self.class_at_hand = class_at_hand;
        if !is_shown {
            self.forget_since(known);
        }
        is_shown
    }

    fn holds_below(&mut self, schema: ExprId, node: u32) -> bool {
        self.shows_below(Direction::Holds, schema, node)
    }

    fn takes_below(&mut self, schema: ExprId, node: u32) -> bool {
        self.shows_below(Direction::Takes, schema, node)
    }

    /// The node accepts a value if and only if it is valid.
    fn is_same(&mut self, schema: ExprId, node: u32, steps: u32) -> bool {
        self.holds(schema, node, steps) && self.takes(schema, node, steps)
    }

    fn are_same(&mut self, schemas: &[ExprId], nodes: &[u32], steps: u32) -> bool {
        schemas.len() == nodes.len()
            && (schemas.iter().zip(nodes)).all(|(&schema, &node)| self.is_same(schema, node, steps))
    }

    fn forget_since(&mut self, known: usize) {
        for claim in self.assumed_in_order.drain(known..) {
            self.assumed.remove(&claim);
        }
    }

    fn holds_for_any(&mut self, schemas: &[ExprId], node: u32, steps: u32) -> bool {
        self.any_of(schemas, |proof, schema| proof.holds(schema, node, steps))
    }

    fn own(&self, schema: ExprId, wanted: &[u8]) -> Option<ExprId> {
        let keywords = properties_of(self.hir, schema)?;
        let found = keywords.iter().find(|it| self.text(it.0) == wanted);
        found.map(|it| it.1)
    }

    /// A map whose names the author chose. In a literal of a program `__proto__` is no key.
    fn names_of(&mut self, keyword: &'p [u8], written: ExprId) -> Option<Properties> {
        let Some(names) = properties_of(self.hir, written) else {
            self.fail(keyword, written, Reason::IsNotWrittenOut);
            return None;
        };
        if let Some(&(_, value)) = names.iter().find(|it| self.text(it.0) == b"__proto__") {
            self.fail(keyword, value, Reason::IsNotCompiled);
            return None;
        }
        Some(names)
    }

    fn list_of(&mut self, keyword: &'p [u8], written: ExprId) -> Option<SmallVec<[ExprId; 8]>> {
        let list = elements_of(self.hir, written);
        if list.is_none() {
            self.fail(keyword, written, Reason::IsNotWrittenOut);
        }
        list
    }

    fn schemas_of(&mut self, keyword: &'p [u8], written: ExprId) -> Option<SmallVec<[ExprId; 8]>> {
        let list = self.list_of(keyword, written)?;
        if list.is_empty() {
            self.fail(keyword, written, Reason::IsEmpty);
            return None;
        }
        Some(list)
    }

    fn takes_everything(&self, node: u32) -> bool {
        let node = &self.nodes[node as usize];
        matches!(node.shape, ValidationShape::Unknown) && node.rules.is_empty()
    }

    // A key that matches a pattern of the node is not undeclared: the node accepts more with such a rule than without it.
    fn has_pattern_members(&self, node: u32) -> bool {
        self.has_rule(node, |rule| {
            matches!(rule, ValidationRule::PatternMembers { .. })
        })
    }

    fn is_pattern_of(&mut self, node: u32, source: Atom) -> bool {
        let wanted = self.file.intern_atom(source);
        self.has_rule(
            node,
            |rule| matches!(rule, ValidationRule::PatternMembers { sources, .. } if sources.contains(&wanted)),
        )
    }

    fn are_patterns_among(&mut self, node: u32, written: &Properties) -> bool {
        let written: SmallVec<[_; 4]> = written
            .iter()
            .map(|&(source, _)| self.file.intern_atom(source))
            .collect();
        self.rules_of(node).iter().all(|rule| match rule {
            ValidationRule::PatternMembers { sources, .. } => {
                sources.iter().all(|source| written.contains(source))
            }
            _ => true,
        })
    }

    fn class_of(&self, node: u32) -> Option<Class> {
        match self.nodes[node as usize].shape {
            ValidationShape::Null => Some(Class::Null),
            ValidationShape::BooleanLiteral { .. } => Some(Class::Boolean),
            ValidationShape::NumberLiteral { value } => value.is_finite().then_some(Class::Number),
            ValidationShape::StringLiteral { .. } => Some(Class::String),
            ValidationShape::Primitive { primitive } => match primitive {
                ValidatedPrimitive::String => Some(Class::String),
                ValidatedPrimitive::Number => Some(Class::Number),
                ValidatedPrimitive::Boolean => Some(Class::Boolean),
                ValidatedPrimitive::BigInt => None,
            },
            ValidationShape::Array { .. } | ValidationShape::Tuple { .. } => Some(Class::Array),
            ValidationShape::Dictionary { .. } | ValidationShape::Object { .. } => {
                Some(Class::Object)
            }
            ValidationShape::Unknown
            | ValidationShape::Never
            | ValidationShape::Undefined
            | ValidationShape::AnyObject
            | ValidationShape::Union { .. } => None,
        }
    }

    fn has_rule(&self, node: u32, is_wanted: impl Fn(&ValidationRule) -> bool) -> bool {
        self.nodes[node as usize].rules.iter().any(is_wanted)
    }

    fn is_integer(&self, node: u32) -> bool {
        match self.nodes[node as usize].shape {
            ValidationShape::NumberLiteral { value } => value.fract() == 0.0,
            _ => self.has_rule(node, |rule| matches!(rule, ValidationRule::Integer)),
        }
    }

    fn is_of_type(&self, node: u32, class: Class, name: &[u8]) -> bool {
        match name {
            b"null" => class == Class::Null,
            b"boolean" => class == Class::Boolean,
            b"number" => class == Class::Number,
            b"integer" => class == Class::Number && self.is_integer(node),
            b"string" => class == Class::String,
            b"array" => class == Class::Array,
            b"object" => class == Class::Object,
            _ => false,
        }
    }

    fn holds_type(&self, written: ExprId, node: u32, class: Class) -> bool {
        let one = [written];
        let listed = elements_of(self.hir, written);
        let names = listed.as_deref().unwrap_or(&one);
        names.iter().any(|&name| match literal_of(self.hir, name) {
            Some(Literal::String(name)) => self.is_of_type(node, class, self.text(name)),
            _ => false,
        })
    }

    fn is_one_of(&mut self, node: u32, allowed: &[ExprId]) -> bool {
        let hir = self.hir;
        let allows = |wanted: Literal| {
            allowed
                .iter()
                .any(|&value| literal_of(hir, value) == Some(wanted))
        };
        match self.nodes[node as usize].shape {
            ValidationShape::Null => allows(Literal::Null),
            ValidationShape::BooleanLiteral { value } => allows(Literal::Boolean(value)),
            ValidationShape::NumberLiteral { value } => allows(Literal::Number(value)),
            ValidationShape::Primitive {
                primitive: ValidatedPrimitive::Boolean,
            } => allows(Literal::Boolean(true)) && allows(Literal::Boolean(false)),
            ValidationShape::StringLiteral { value } => {
                allowed
                    .iter()
                    .any(|&allowed| match literal_of(hir, allowed) {
                        Some(Literal::String(text)) => self.file.intern_atom(text) == value,
                        _ => false,
                    })
            }
            _ => false,
        }
    }

    /// The node accepts nothing but the value that is written.
    fn is_exactly(&mut self, node: u32, value: ExprId) -> bool {
        let (hir, nodes) = (self.hir, self.nodes);
        if literal_of(hir, value).is_some() {
            return self.is_literal(node) && self.is_one_of(node, &[value]);
        }
        match &nodes[node as usize].shape {
            ValidationShape::Tuple {
                elements,
                required,
                rest: None,
            } => match elements_of(hir, value) {
                Some(written) => {
                    *required as usize == elements.len()
                        && written.len() == elements.len()
                        && (written.iter().zip(elements))
                            .all(|(&value, &element)| self.is_exactly(element, value))
                }
                None => false,
            },
            ValidationShape::Object {
                members,
                undeclared: UndeclaredMembers::Rejected,
                ..
            } => {
                let Some(written) = self.names_of(b"const", value) else {
                    return false;
                };
                !self.has_pattern_members(node)
                    && written.len() == members.len()
                    && written.iter().all(|&(name, value)| {
                        let key = self.file.name_key(name);
                        members.iter().any(|member| {
                            member.key == key
                                && !member.is_optional
                                && self.is_exactly(member.node, value)
                        })
                    })
            }
            _ => false,
        }
    }

    fn is_any_of(&mut self, node: u32, allowed: &[ExprId]) -> bool {
        self.is_one_of(node, allowed)
            || self.any_of(allowed, |proof, value| proof.is_exactly(node, value))
    }

    /// What "#" points at, or "#/" and a path through the keywords that hold schemas.
    fn find_referenced(&self, reference: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let Some(Literal::String(pointer)) = literal_of(hir, reference) else {
            return None;
        };
        let path = self.text(pointer).strip_prefix(b"#")?;
        let mut at = self.root;
        if path.is_empty() {
            return Some(at);
        }
        let path = path.strip_prefix(b"/")?;
        if strings::contains_char(path, b'%') {
            return None;
        }
        let mut segments = strings::split(path, b"/");
        while let Some(keyword) = segments.next() {
            let held = self.own(at, keyword)?;
            at = match keyword {
                b"not"
                | b"if"
                | b"then"
                | b"else"
                | b"contains"
                | b"propertyNames"
                | b"additionalProperties"
                | b"additionalItems" => held,
                b"items" if elements_of(hir, held).is_none() => held,
                b"allOf" | b"anyOf" | b"oneOf" | b"prefixItems" | b"items" => {
                    let index = index_of_pointer_segment(segments.next()?)?;
                    *elements_of(hir, held)?.get(index)?
                }
                b"properties" | b"patternProperties" | b"$defs" | b"definitions"
                | b"dependentSchemas" => {
                    let name = unescape_pointer_segment(segments.next()?)?;
                    if name == b"__proto__" {
                        return None;
                    }
                    self.own(held, &name)?
                }
                _ => return None,
            };
            // Another document begins there.
            if self.own(at, b"$id").is_some() {
                return None;
            }
        }
        Some(at)
    }

    fn keywords_of(&self, schema: ExprId) -> Keywords {
        Keywords {
            properties: self.own(schema, b"properties"),
            pattern_properties: self.own(schema, b"patternProperties"),
            prefix_items: self.own(schema, b"prefixItems"),
            items: self.own(schema, b"items"),
            additional_items: self.own(schema, b"additionalItems"),
            contains: self.own(schema, b"contains"),
            min_contains: self.own(schema, b"minContains"),
            max_contains: self.own(schema, b"maxContains"),
            condition: self.own(schema, b"if"),
            then: self.own(schema, b"then"),
            otherwise: self.own(schema, b"else"),
            is_root: schema == self.root,
        }
    }

    /// What is not read is refused wherever in the document it stands: nothing is ignored.
    fn reads(&mut self, schema: ExprId) -> bool {
        match literal_of(self.hir, schema) {
            Some(Literal::Boolean(_)) => return true,
            Some(_) => return self.fail(b"", schema, Reason::IsNotWrittenOut),
            None => {}
        }
        let Some(keywords) = properties_of(self.hir, schema) else {
            return self.fail(b"", schema, Reason::IsNotWrittenOut);
        };
        let context = self.keywords_of(schema);
        let is_reference = self.draft == Draft::Draft7 && self.own(schema, b"$ref").is_some();
        keywords.iter().all(|&(keyword, written)| {
            let keyword = self.text(keyword);
            self.reads_keyword(keyword, written, &context, is_reference)
        })
    }

    fn reads_keyword(
        &mut self,
        keyword: &'p [u8],
        written: ExprId,
        context: &Keywords,
        is_reference: bool,
    ) -> bool {
        let hir = self.hir;
        let is_list =
            |written: Option<ExprId>| written.is_some_and(|it| elements_of(hir, it).is_some());
        match (self.draft, keyword) {
            (
                Draft::Draft7,
                b"prefixItems"
                | b"minContains"
                | b"maxContains"
                | b"dependentRequired"
                | b"dependentSchemas"
                | b"unevaluatedItems"
                | b"unevaluatedProperties"
                | b"$anchor"
                | b"$dynamicRef"
                | b"$dynamicAnchor"
                | b"$vocabulary",
            )
            | (Draft::Draft2020, b"additionalItems" | b"dependencies") => {
                return self.fail(keyword, written, Reason::IsOfAnotherDraft);
            }
            (Draft::Draft2020, b"items") if is_list(Some(written)) => {
                return self.fail(keyword, written, Reason::IsOfAnotherDraft);
            }
            _ => {}
        }
        let has_partner = match keyword {
            b"then" | b"else" => context.condition.is_some(),
            b"minContains" | b"maxContains" => context.contains.is_some(),
            b"additionalItems" => is_list(context.items),
            _ => true,
        };
        if !has_partner {
            return self.fail(keyword, written, Reason::LacksItsPartner);
        }
        let is_of_the_document = context.is_root && matches!(keyword, b"$schema" | b"$id");
        if is_reference && keyword != b"$ref" && !is_without_meaning(keyword) && !is_of_the_document
        {
            return self.fail(keyword, written, Reason::StandsBesideReference);
        }
        match keyword {
            b"$defs" | b"definitions" | b"properties" | b"patternProperties"
            | b"dependentSchemas" | b"dependencies" => match self.names_of(keyword, written) {
                Some(named) => named.iter().all(|&(_, schema)| {
                    match keyword == b"dependencies" && is_list(Some(schema)) {
                        true => self.reads_names(keyword, schema),
                        false => self.reads(schema),
                    }
                }),
                None => false,
            },
            _ if is_without_meaning(keyword) => true,
            b"not"
            | b"if"
            | b"then"
            | b"else"
            | b"contains"
            | b"propertyNames"
            | b"additionalProperties"
            | b"additionalItems" => self.reads(written),
            b"items" if !is_list(Some(written)) => self.reads(written),
            b"allOf" | b"anyOf" | b"oneOf" | b"prefixItems" | b"items" => {
                match self.schemas_of(keyword, written) {
                    Some(schemas) => schemas.iter().all(|&schema| self.reads(schema)),
                    None => false,
                }
            }
            b"$schema" | b"$id" => {
                let is_text = matches!(literal_of(hir, written), Some(Literal::String(_)));
                (context.is_root && is_text) || self.fail(keyword, written, Reason::IsNotCompiled)
            }
            b"$ref" => {
                self.find_referenced(written).is_some()
                    || self.fail(keyword, written, Reason::IsNotCompiled)
            }
            b"const" => self.reads_value(keyword, written, 0),
            b"enum" => match self.list_of(keyword, written) {
                Some(allowed) => (allowed.iter()).all(|&value| self.reads_value(keyword, value, 0)),
                None => false,
            },
            b"type" => {
                let one = [written];
                let listed = elements_of(hir, written);
                let names = listed.as_deref().unwrap_or(&one);
                if names.is_empty() {
                    return self.fail(keyword, written, Reason::IsEmpty);
                }
                names.iter().all(|&name| match literal_of(hir, name) {
                    Some(Literal::String(name)) if class_named(self.text(name)).is_some() => true,
                    Some(_) => self.fail(keyword, name, Reason::IsNotKnown),
                    None => self.fail(keyword, name, Reason::IsMalformed),
                })
            }
            b"format" => match literal_of(hir, written) {
                Some(Literal::String(name)) if format_named(self.text(name)).is_some() => true,
                Some(Literal::String(_)) => self.fail(keyword, written, Reason::IsNotKnown),
                _ => self.fail(keyword, written, Reason::IsMalformed),
            },
            b"minLength" | b"maxLength" | b"minItems" | b"maxItems" | b"minContains"
            | b"maxContains" | b"minProperties" | b"maxProperties" => {
                count_of(hir, written).is_some() || self.fail(keyword, written, Reason::IsMalformed)
            }
            b"minimum" | b"maximum" | b"exclusiveMinimum" | b"exclusiveMaximum" => {
                number_of(hir, written).is_some()
                    || self.fail(keyword, written, Reason::IsMalformed)
            }
            b"multipleOf" => {
                number_of(hir, written).is_some_and(|divisor| divisor > 0.0)
                    || self.fail(keyword, written, Reason::IsMalformed)
            }
            b"pattern" => {
                matches!(literal_of(hir, written), Some(Literal::String(_)))
                    || self.fail(keyword, written, Reason::IsMalformed)
            }
            b"uniqueItems" => {
                matches!(literal_of(hir, written), Some(Literal::Boolean(_)))
                    || self.fail(keyword, written, Reason::IsMalformed)
            }
            b"required" => self.reads_names(keyword, written),
            b"dependentRequired" => match self.names_of(keyword, written) {
                Some(dependents) => {
                    (dependents.iter()).all(|&(_, names)| self.reads_names(keyword, names))
                }
                None => false,
            },
            b"unevaluatedItems"
            | b"unevaluatedProperties"
            | b"$anchor"
            | b"$dynamicRef"
            | b"$dynamicAnchor"
            | b"$vocabulary" => self.fail(keyword, written, Reason::IsNotCompiled),
            _ => self.fail(keyword, written, Reason::IsNotKnown),
        }
    }

    fn reads_names(&mut self, keyword: &'p [u8], written: ExprId) -> bool {
        let hir = self.hir;
        match self.list_of(keyword, written) {
            Some(names) => names.iter().all(|&name| {
                matches!(literal_of(hir, name), Some(Literal::String(_)))
                    || self.fail(keyword, name, Reason::IsMalformed)
            }),
            None => false,
        }
    }

    /// A value of `const` | `enum`: what JSON text can write, to its last part.
    fn reads_value(&mut self, keyword: &'p [u8], value: ExprId, depth: u32) -> bool {
        if depth > MAX_STEPS_AT_ONE_VALUE {
            return self.fail(keyword, value, Reason::IsTooLarge);
        }
        if literal_of(self.hir, value).is_some() {
            return true;
        }
        if let Some(elements) = elements_of(self.hir, value) {
            return (elements.iter()).all(|&element| self.reads_value(keyword, element, depth + 1));
        }
        match self.names_of(keyword, value) {
            Some(members) => {
                (members.iter()).all(|&(_, member)| self.reads_value(keyword, member, depth + 1))
            }
            None => false,
        }
    }

    fn holds(&mut self, schema: ExprId, node: u32, steps: u32) -> bool {
        if !self.spend(schema, steps) {
            return false;
        }
        if literal_of(self.hir, schema) == Some(Literal::Boolean(true)) {
            return true;
        }
        let nodes = self.nodes;
        match &nodes[node as usize].shape {
            ValidationShape::Never => return true,
            ValidationShape::Union { arms } => {
                return arms.iter().all(|&arm| self.holds(schema, arm, steps + 1));
            }
            _ => {}
        }
        match literal_of(self.hir, schema) {
            Some(Literal::Boolean(_)) => return self.fail(b"", schema, Reason::TypeAcceptsMore),
            Some(_) => return self.fail(b"", schema, Reason::IsNotWrittenOut),
            None => {}
        }
        let Some(keywords) = properties_of(self.hir, schema) else {
            return self.fail(b"", schema, Reason::IsNotWrittenOut);
        };
        let class = self.class_of(node).or(self.class_at_hand);
        let outer = std::mem::replace(&mut self.class_at_hand, class);
        let holds = self.holds_keywords(schema, &keywords, node, class, steps);
        self.class_at_hand = outer;
        holds
    }

    /// Infinity, `undefined`, a function fail every schema that says anything.
    fn find_what_it_says(&self, keywords: &Properties) -> Option<(Atom, ExprId)> {
        let found = keywords.iter().find(|&&(keyword, _)| {
            let keyword = self.text(keyword);
            !is_without_meaning(keyword) && !matches!(keyword, b"$schema" | b"$id")
        });
        found.copied()
    }

    /// `true`, `{}`, annotations alone: every value is valid, also what is no JSON value.
    fn says_nothing(&self, schema: ExprId) -> bool {
        match literal_of(self.hir, schema) {
            Some(literal) => literal == Literal::Boolean(true),
            None => properties_of(self.hir, schema)
                .is_some_and(|keywords| self.find_what_it_says(&keywords).is_none()),
        }
    }

    /// Whatever the node accepts is null, a boolean, a finite number, a string, an array or an object.
    fn accepts_json_alone(&self, node: u32, steps: u32) -> bool {
        if steps > MAX_STEPS_AT_ONE_VALUE {
            return false;
        }
        let all = |nodes: &[u32]| {
            nodes
                .iter()
                .all(|&one| self.accepts_json_alone(one, steps + 1))
        };
        let by_shape = match &self.nodes[node as usize].shape {
            ValidationShape::Never => true,
            ValidationShape::Union { arms } => all(arms),
            _ => self.class_of(node).is_some(),
        };
        by_shape
            || self.has_rule(node, |rule| match rule {
                ValidationRule::Every { nodes } => nodes
                    .iter()
                    .any(|&one| self.accepts_json_alone(one, steps + 1)),
                ValidationRule::ExactlyOne { nodes } => all(nodes),
                ValidationRule::If {
                    then, otherwise, ..
                } => all(&[*then, *otherwise]),
                ValidationRule::Not { node } => self.takes_everything(*node),
                _ => false,
            })
    }

    fn holds_keywords(
        &mut self,
        schema: ExprId,
        keywords: &Properties,
        node: u32,
        class: Option<Class>,
        steps: u32,
    ) -> bool {
        if let Some((keyword, written)) = self.find_what_it_says(keywords)
            && class.is_none()
            && !self.accepts_json_alone(node, 0)
        {
            let keyword = self.text(keyword);
            return self.fail(keyword, written, Reason::TypeAcceptsWhatIsNotJson);
        }
        let context = self.keywords_of(schema);
        if self.draft == Draft::Draft7
            && let Some(reference) = self.own(schema, b"$ref")
        {
            return match self.find_referenced(reference) {
                Some(referenced) => self.holds(referenced, node, steps + 1),
                None => self.fail(b"$ref", reference, Reason::IsNotCompiled),
            };
        }
        keywords.iter().all(|&(keyword, written)| {
            let keyword = self.text(keyword);
            self.attempt(|proof| {
                proof.attempt(|proof| {
                    proof.holds_keyword(keyword, written, node, class, &context, steps)
                }) || proof.holds_by_a_part(keyword, written, node, &context, steps + 1)
            }) || self.fail(keyword, written, Reason::TypeAcceptsMore)
        })
    }

    // What the node accepts, each node of its `Every` accepts.
    fn holds_by_a_part(
        &mut self,
        keyword: &'p [u8],
        written: ExprId,
        node: u32,
        context: &Keywords,
        steps: u32,
    ) -> bool {
        self.any_rule(node, |proof, rule| match rule {
            ValidationRule::Every { nodes } => proof.any_of(nodes, |proof, part| {
                proof.holds_keyword_for(keyword, written, part, context, steps)
            }),
            _ => false,
        })
    }

    /// One keyword of a schema, for whatever the node accepts.
    fn holds_keyword_for(
        &mut self,
        keyword: &'p [u8],
        written: ExprId,
        node: u32,
        context: &Keywords,
        steps: u32,
    ) -> bool {
        if !self.spend(written, steps) {
            return false;
        }
        let nodes = self.nodes;
        match &nodes[node as usize].shape {
            ValidationShape::Never => return true,
            ValidationShape::Union { arms } => {
                return arms
                    .iter()
                    .all(|&arm| self.holds_keyword_for(keyword, written, arm, context, steps + 1));
            }
            _ => {}
        }
        let class = self.class_of(node).or(self.class_at_hand);
        let outer = std::mem::replace(&mut self.class_at_hand, class);
        let holds = self
            .attempt(|proof| proof.holds_keyword(keyword, written, node, class, context, steps))
            || self.holds_by_a_part(keyword, written, node, context, steps + 1);
        self.class_at_hand = outer;
        holds
    }

    fn holds_keyword(
        &mut self,
        keyword: &'p [u8],
        written: ExprId,
        node: u32,
        class: Option<Class>,
        context: &Keywords,
        steps: u32,
    ) -> bool {
        let hir = self.hir;
        // A keyword for values of one class says nothing about the others.
        let concerns = |wanted: Class| class.map(|class| class == wanted);
        match keyword {
            _ if is_without_meaning(keyword) => true,
            b"$schema" | b"$id" => context.is_root,
            // Read with the keyword that they go with.
            b"then" | b"else" | b"minContains" | b"maxContains" => true,
            b"format" => self.holds_format(written, node, concerns(Class::String)),
            b"$ref" => match self.find_referenced(written) {
                Some(referenced) => self.holds(referenced, node, steps + 1),
                None => self.fail(keyword, written, Reason::IsNotCompiled),
            },
            b"type" => class.is_some_and(|class| self.holds_type(written, node, class)),
            b"const" => self.is_any_of(node, &[written]),
            b"enum" => match self.list_of(keyword, written) {
                Some(allowed) => self.is_any_of(node, &allowed),
                None => false,
            },
            b"allOf" => match self.schemas_of(keyword, written) {
                Some(all) => all
                    .iter()
                    .all(|&part| self.holds_part(part, node, steps + 1)),
                None => false,
            },
            b"anyOf" => match self.schemas_of(keyword, written) {
                Some(arms) => self.holds_for_any(&arms, node, steps + 1),
                None => false,
            },
            b"oneOf" => match self.schemas_of(keyword, written) {
                Some(arms) => {
                    self.attempt(|proof| proof.holds_for_exactly_one(&arms, node, steps + 1))
                        || self.any_rule(node, |proof, rule| match rule {
                            ValidationRule::ExactlyOne { nodes } => {
                                proof.are_same(&arms, nodes, steps + 1)
                            }
                            _ => false,
                        })
                }
                None => false,
            },
            b"not" => {
                self.attempt(|proof| proof.excludes(written, node))
                    || self.any_rule(node, |proof, rule| match *rule {
                        ValidationRule::Not { node: refused } => {
                            proof.takes(written, refused, steps + 1)
                        }
                        _ => false,
                    })
            }
            b"if" => self.holds_condition(written, node, context, steps + 1),
            b"minLength" | b"maxLength" | b"pattern" => match concerns(Class::String) {
                Some(true) => self.holds_text_rule(keyword, written, node),
                Some(false) => true,
                None => false,
            },
            b"minimum" | b"maximum" | b"exclusiveMinimum" | b"exclusiveMaximum" | b"multipleOf" => {
                match concerns(Class::Number) {
                    Some(true) => self.holds_number_rule(keyword, written, node),
                    Some(false) => true,
                    None => false,
                }
            }
            b"items" | b"prefixItems" | b"additionalItems" | b"minItems" | b"maxItems" => {
                match concerns(Class::Array) {
                    Some(true) => self.holds_array_keyword(keyword, written, node, context),
                    Some(false) => true,
                    None => false,
                }
            }
            b"uniqueItems" => match literal_of(hir, written) {
                Some(Literal::Boolean(false)) => true,
                Some(Literal::Boolean(true)) => {
                    concerns(Class::Array) == Some(false)
                        || self.has_rule(node, |rule| {
                            matches!(rule, ValidationRule::UniqueItems { .. })
                        })
                }
                _ => self.fail(keyword, written, Reason::IsNotWrittenOut),
            },
            b"contains" => {
                let asks_for_none =
                    (context.min_contains).is_some_and(|written| count_of(hir, written) == Some(0));
                concerns(Class::Array) == Some(false)
                    || (asks_for_none && context.max_contains.is_none())
                    || self.any_rule(node, |proof, rule| {
                        proof.counts_the_same(Direction::Holds, written, context, rule)
                    })
            }
            b"properties" | b"required" | b"additionalProperties" => {
                match concerns(Class::Object) {
                    Some(true) => self.holds_object_keyword(keyword, written, node, context),
                    Some(false) => true,
                    None => false,
                }
            }
            b"patternProperties" | b"propertyNames" | b"minProperties" | b"maxProperties"
            | b"dependentRequired" | b"dependentSchemas" | b"dependencies" => {
                concerns(Class::Object) == Some(false)
                    || self.holds_member_rule(keyword, written, node, steps + 1)
            }
            _ => self.fail(keyword, written, Reason::IsNotKnown),
        }
    }

    fn holds_format(&mut self, written: ExprId, node: u32, concerns_text: Option<bool>) -> bool {
        let Some(Literal::String(name)) = literal_of(self.hir, written) else {
            return self.fail(b"format", written, Reason::IsNotWrittenOut);
        };
        let Some(wanted) = format_named(self.text(name)) else {
            return self.fail(b"format", written, Reason::IsNotKnown);
        };
        if !self.asserts_formats || concerns_text == Some(false) {
            return true;
        }
        matches!(
            self.nodes[node as usize].shape,
            ValidationShape::Primitive { .. }
        ) && concerns_text == Some(true)
            && self.has_rule(
                node,
                |rule| matches!(*rule, ValidationRule::Format { format } if format == wanted),
            )
    }

    // What the node accepts, each node of its `Every` accepts.
    fn holds_part(&mut self, part: ExprId, node: u32, steps: u32) -> bool {
        self.attempt(|proof| proof.holds(part, node, steps))
            || self.any_rule(node, |proof, rule| match rule {
                ValidationRule::Every { nodes } => {
                    proof.any_of(nodes, |proof, one| proof.holds(part, one, steps))
                }
                _ => false,
            })
    }

    fn holds_condition(
        &mut self,
        condition: ExprId,
        node: u32,
        context: &Keywords,
        steps: u32,
    ) -> bool {
        if context.then.is_none() && context.otherwise.is_none() {
            return true;
        }
        self.any_rule(node, |proof, rule| match *rule {
            ValidationRule::If {
                condition: tested,
                then,
                otherwise,
            } => {
                proof.is_same(condition, tested, steps)
                    && (context.then).is_none_or(|written| proof.holds(written, then, steps))
                    && (context.otherwise)
                        .is_none_or(|written| proof.holds(written, otherwise, steps))
            }
            _ => false,
        })
    }

    /// `contains` with its bounds against a rule. A lower bound carries over if each element that counts on the side that is known counts on the other; an upper bound the other way round.
    fn counts_the_same(
        &mut self,
        direction: Direction,
        contains: ExprId,
        context: &Keywords,
        rule: &ValidationRule,
    ) -> bool {
        let hir = self.hir;
        let ValidationRule::Contains {
            node: counted,
            minimum,
            maximum,
        } = *rule
        else {
            return false;
        };
        let wanted_minimum = match context.min_contains {
            Some(written) => count_of(hir, written),
            None => Some(1),
        };
        let wanted_maximum = match context.max_contains {
            Some(written) => match count_of(hir, written) {
                Some(count) => Some(count),
                None => return false,
            },
            None => None,
        };
        let opposite = match direction {
            Direction::Holds => Direction::Takes,
            Direction::Takes => Direction::Holds,
        };
        Some(minimum) == wanted_minimum
            && maximum == wanted_maximum
            && (minimum == 0 || self.shows_below(direction, contains, counted))
            && (maximum.is_none() || self.shows_below(opposite, contains, counted))
    }

    fn holds_member_rule(
        &mut self,
        keyword: &'p [u8],
        written: ExprId,
        node: u32,
        steps: u32,
    ) -> bool {
        let hir = self.hir;
        match keyword {
            b"propertyNames" => self.any_rule(node, |proof, rule| match *rule {
                ValidationRule::MemberNames { node: name } => proof.holds_below(written, name),
                _ => false,
            }),
            b"minProperties" | b"maxProperties" => {
                let Some(wanted) = count_of(hir, written) else {
                    return self.fail(keyword, written, Reason::IsNotWrittenOut);
                };
                let is_minimum = keyword == b"minProperties";
                (is_minimum && wanted == 0)
                    || self.has_rule(node, |rule| match *rule {
                        ValidationRule::MinimumMembers { count } => is_minimum && count >= wanted,
                        ValidationRule::MaximumMembers { count } => !is_minimum && count <= wanted,
                        _ => false,
                    })
            }
            b"patternProperties" => {
                let Some(patterns) = self.names_of(keyword, written) else {
                    return false;
                };
                // The sources of such a rule have the flag `u`, as those of the keyword have.
                patterns.iter().all(|&(source, schema)| {
                    let wanted = self.file.intern_atom(source);
                    self.any_rule(node, |proof, rule| match rule {
                        ValidationRule::PatternMembers { sources, nodes } => {
                            sources.len() == nodes.len()
                                && (sources.iter().zip(nodes)).any(|(&source, &held)| {
                                    source == wanted
                                        && proof.attempt(|proof| proof.holds_below(schema, held))
                                })
                        }
                        _ => false,
                    })
                })
            }
            _ => {
                let Some(dependents) = self.names_of(keyword, written) else {
                    return false;
                };
                dependents.iter().all(|&(key, dependent)| {
                    let key = self.file.intern_atom(key);
                    match (keyword, elements_of(hir, dependent)) {
                        (b"dependentRequired" | b"dependencies", Some(names)) => {
                            let mut wanted = SmallVec::<[_; 4]>::new();
                            for &name in &names {
                                let Some(Literal::String(name)) = literal_of(hir, name) else {
                                    return self.fail(keyword, name, Reason::IsNotWrittenOut);
                                };
                                wanted.push(self.file.intern_atom(name));
                            }
                            wanted.is_empty()
                                || self.has_rule(node, |rule| match rule {
                                    ValidationRule::DependentMembers { key: known, names } => {
                                        *known == key
                                            && wanted.iter().all(|name| names.contains(name))
                                    }
                                    _ => false,
                                })
                        }
                        (b"dependentSchemas" | b"dependencies", None) => {
                            self.any_rule(node, |proof, rule| match *rule {
                                ValidationRule::DependentNode {
                                    key: known,
                                    node: held,
                                } => known == key && proof.holds(dependent, held, steps),
                                _ => false,
                            })
                        }
                        _ => self.fail(keyword, dependent, Reason::IsNotWrittenOut),
                    }
                })
            }
        }
    }

    fn holds_text_rule(&mut self, keyword: &[u8], written: ExprId, node: u32) -> bool {
        if !matches!(
            self.nodes[node as usize].shape,
            ValidationShape::Primitive { .. }
        ) {
            return false;
        }
        if keyword == b"pattern" {
            let Some(Literal::String(source)) = literal_of(self.hir, written) else {
                return false;
            };
            // The keyword means the flag `u`.
            let wanted = self.file.intern_atom(source);
            return self.has_rule(node, |rule| {
                matches!(
                    *rule,
                    ValidationRule::Pattern {
                        source,
                        is_unicode: true,
                    } if source == wanted
                )
            });
        }
        let Some(wanted) = count_of(self.hir, written) else {
            return false;
        };
        self.has_rule(node, |rule| match rule {
            ValidationRule::MinimumLength { length } => {
                keyword == b"minLength" && *length == wanted
            }
            ValidationRule::MaximumLength { length } => {
                keyword == b"maxLength" && *length == wanted
            }
            _ => false,
        })
    }

    fn holds_number_rule(&mut self, keyword: &[u8], written: ExprId, node: u32) -> bool {
        if !matches!(
            self.nodes[node as usize].shape,
            ValidationShape::Primitive { .. }
        ) {
            return false;
        }
        let Some(wanted) = number_of(self.hir, written) else {
            return false;
        };
        self.has_rule(node, |rule| match *rule {
            ValidationRule::Minimum { bound } => keyword == b"minimum" && bound == wanted,
            ValidationRule::Maximum { bound } => keyword == b"maximum" && bound == wanted,
            ValidationRule::ExclusiveMinimum { bound } => {
                keyword == b"exclusiveMinimum" && bound == wanted
            }
            ValidationRule::ExclusiveMaximum { bound } => {
                keyword == b"exclusiveMaximum" && bound == wanted
            }
            ValidationRule::MultipleOf { divisor } => keyword == b"multipleOf" && divisor == wanted,
            _ => false,
        })
    }

    /// The schemas by position, and the one for every element behind them.
    fn positions_of(&self, context: &Keywords) -> Option<(SmallVec<[ExprId; 8]>, Option<ExprId>)> {
        let hir = self.hir;
        match self.draft {
            Draft::Draft2020 => {
                let positional = match context.prefix_items {
                    Some(list) => elements_of(hir, list)?,
                    None => SmallVec::new(),
                };
                match context.items {
                    Some(items) if elements_of(hir, items).is_some() => None,
                    behind => Some((positional, behind)),
                }
            }
            Draft::Draft7 => match context.items {
                Some(items) => match elements_of(hir, items) {
                    Some(positional) => Some((positional, context.additional_items)),
                    None => Some((SmallVec::new(), Some(items))),
                },
                None => Some((SmallVec::new(), None)),
            },
        }
    }

    fn holds_array_keyword(
        &mut self,
        keyword: &'p [u8],
        written: ExprId,
        node: u32,
        context: &Keywords,
    ) -> bool {
        let (hir, nodes) = (self.hir, self.nodes);
        // What stands at each place, what stands behind them, the least length, and the greatest if there is one.
        let (elements, rest, shortest, longest): (&[u32], Option<u32>, u32, Option<u32>) =
            match &nodes[node as usize].shape {
                ValidationShape::Tuple {
                    elements,
                    required,
                    rest,
                } => {
                    let longest = rest.is_none().then_some(elements.len() as u32);
                    (&elements[..], *rest, *required, longest)
                }
                ValidationShape::Array { element } => (&[][..], Some(*element), 0, None),
                _ => return false,
            };
        if matches!(keyword, b"minItems" | b"maxItems") {
            let Some(wanted) = count_of(hir, written) else {
                return self.fail(keyword, written, Reason::IsNotWrittenOut);
            };
            return match keyword {
                b"minItems" => {
                    shortest >= wanted
                        || self.has_rule(
                            node,
                            |rule| matches!(*rule, ValidationRule::MinimumLength { length } if length >= wanted),
                        )
                }
                _ => {
                    longest.is_some_and(|longest| longest <= wanted)
                        || self.has_rule(
                            node,
                            |rule| matches!(*rule, ValidationRule::MaximumLength { length } if length <= wanted),
                        )
                }
            };
        }
        let Some((positional, behind)) = self.positions_of(context) else {
            return self.fail(keyword, written, Reason::IsNotWrittenOut);
        };
        if behind == Some(written) {
            return (elements.iter().skip(positional.len()).chain(rest.iter()))
                .all(|&element| self.holds_below(written, element));
        }
        positional.iter().enumerate().all(|(index, &schema)| {
            match elements.get(index).or(rest.as_ref()) {
                Some(&element) => self.holds_below(schema, element),
                None => true,
            }
        })
    }

    // What a member holds where it is there. An optional one may hold `undefined`, which counts as absent.
    fn arms_of_member(&self, member: &ValidationMember) -> SmallVec<[u32; 4]> {
        let is_undefined = |&arm: &u32| {
            member.is_optional
                && matches!(self.nodes[arm as usize].shape, ValidationShape::Undefined)
        };
        match &self.nodes[member.node as usize].shape {
            ValidationShape::Union { arms }
                if self.nodes[member.node as usize].rules.is_empty() =>
            {
                arms.iter()
                    .copied()
                    .filter(|arm| !is_undefined(arm))
                    .collect()
            }
            _ => SmallVec::from_slice(&[member.node]),
        }
    }

    fn holds_for_member(&mut self, schema: ExprId, member: &ValidationMember) -> bool {
        let arms = self.arms_of_member(member);
        arms.iter().all(|&arm| self.holds_below(schema, arm))
    }

    fn holds_object_keyword(
        &mut self,
        keyword: &'p [u8],
        written: ExprId,
        node: u32,
        context: &Keywords,
    ) -> bool {
        let (hir, nodes) = (self.hir, self.nodes);
        let (members, undeclared, undeclared_value): (&[ValidationMember], _, _) =
            match &nodes[node as usize].shape {
                ValidationShape::Object {
                    members,
                    undeclared,
                    undeclared_value,
                    ..
                } => (&members[..], *undeclared, *undeclared_value),
                ValidationShape::Dictionary { value } if !self.has_pattern_members(node) => {
                    (&[][..], UndeclaredMembers::Validated, Some(*value))
                }
                _ => return false,
            };
        match keyword {
            b"properties" => {
                let Some(declared) = self.names_of(keyword, written) else {
                    return false;
                };
                let has_patterns = self.has_pattern_members(node);
                declared.iter().all(|&(name, schema)| {
                    let key = self.file.name_key(name);
                    match members.iter().find(|member| member.key == key) {
                        Some(member) => self.holds_for_member(schema, member),
                        // The name may match a pattern of the node.
                        None if has_patterns => false,
                        None => match (undeclared, undeclared_value) {
                            (UndeclaredMembers::Rejected, _) => true,
                            (UndeclaredMembers::Validated, Some(value)) => {
                                self.holds_below(schema, value)
                            }
                            _ => false,
                        },
                    }
                })
            }
            b"required" => {
                let Some(names) = self.list_of(keyword, written) else {
                    return false;
                };
                names.iter().all(|&name| {
                    let Some(Literal::String(name)) = literal_of(hir, name) else {
                        return false;
                    };
                    let key = self.file.name_key(name);
                    members.iter().any(|member| {
                        member.key == key
                            && !member.is_optional
                            && (self.source == Source::Text || !self.may_be_undefined(member.node))
                    })
                })
            }
            b"additionalProperties" => {
                let mut read = |written: Option<ExprId>, keyword: &'p [u8]| match written {
                    Some(written) => self.names_of(keyword, written),
                    None => Some(Properties::new()),
                };
                let (Some(declared), Some(patterns)) = (
                    read(context.properties, b"properties"),
                    read(context.pattern_properties, b"patternProperties"),
                ) else {
                    return false;
                };
                // A key that the node lets through for a pattern must be one that the keyword does not speak of.
                if !self.are_patterns_among(node, &patterns) {
                    return false;
                }
                let declared: SmallVec<[_; 8]> = declared
                    .iter()
                    .map(|&(name, _)| self.file.name_key(name))
                    .collect();
                let says_nothing = self.says_nothing(written);
                // An optional member may hold `undefined`. To `properties` it is absent then; to this keyword it is a key.
                let refuses_undefined = self.source == Source::Value && !says_nothing;
                let is_key_without_value =
                    |member: &ValidationMember| refuses_undefined && member.is_optional;
                let holds_for_others = members
                    .iter()
                    .filter(|member| !declared.contains(&member.key))
                    .all(|member| {
                        !is_key_without_value(member) && self.holds_for_member(written, member)
                    });
                holds_for_others
                    && match (undeclared, undeclared_value) {
                        (UndeclaredMembers::Rejected, _) => true,
                        (UndeclaredMembers::Validated, Some(value)) => {
                            self.holds_below(written, value)
                        }
                        (UndeclaredMembers::Allowed | UndeclaredMembers::Validated, _) => {
                            says_nothing
                        }
                    }
            }
            _ => false,
        }
    }

    fn holds_for_exactly_one(&mut self, arms: &[ExprId], node: u32, steps: u32) -> bool {
        let Some(chosen) =
            (0..arms.len()).find(|&at| self.holds_for_any(&arms[at..=at], node, steps))
        else {
            return false;
        };
        (0..arms.len())
            .filter(|&at| at != chosen)
            .all(|at| self.excludes(arms[at], node))
    }

    /// No value that the node accepts is valid under the schema.
    fn excludes(&mut self, schema: ExprId, node: u32) -> bool {
        let hir = self.hir;
        if literal_of(hir, schema) == Some(Literal::Boolean(false)) {
            return true;
        }
        let (Some(keywords), Some(class)) = (properties_of(hir, schema), self.class_of(node))
        else {
            return false;
        };
        let find = |proof: &Self, wanted: &[u8]| {
            let found = keywords.iter().find(|it| proof.text(it.0) == wanted);
            found.map(|it| it.1)
        };
        if find(self, b"$ref").is_some() {
            return false;
        }
        if let Some(written) = find(self, b"type") {
            let one = [written];
            let listed = elements_of(hir, written);
            let names = listed.as_deref().unwrap_or(&one);
            let may_be = names.iter().any(|&name| match literal_of(hir, name) {
                Some(Literal::String(name)) => match self.text(name) {
                    b"integer" => class == Class::Number,
                    name => self.is_of_type(node, class, name),
                },
                _ => true,
            });
            if !may_be {
                return true;
            }
        }
        if let Some(written) = find(self, b"const") {
            if self.is_literal(node) && literal_of(hir, written).is_some() {
                return !self.is_one_of(node, &[written]);
            }
        }
        let ValidationShape::Object { members, .. } = &self.nodes[node as usize].shape else {
            return false;
        };
        let members = members.clone();
        let (Some(declared), Some(required)) = (find(self, b"properties"), find(self, b"required"))
        else {
            return false;
        };
        let (Some(declared), Some(required)) =
            (properties_of(hir, declared), elements_of(hir, required))
        else {
            return false;
        };
        // A member that both require, and whose values here are none of the values there.
        declared.iter().any(|&(name, schema)| {
            let is_required = required
                .iter()
                .any(|&it| literal_of(hir, it) == Some(Literal::String(name)));
            let key = self.file.name_key(name);
            let member = members
                .iter()
                .find(|member| member.key == key && !member.is_optional);
            match member {
                Some(member) if is_required => {
                    let arms: SmallVec<[u32; 4]> = match &self.nodes[member.node as usize].shape {
                        ValidationShape::Union { arms } => SmallVec::from_slice(arms),
                        _ => SmallVec::from_slice(&[member.node]),
                    };
                    arms.iter().all(|&arm| self.excludes(schema, arm))
                }
                _ => false,
            }
        })
    }

    fn may_be_undefined(&self, node: u32) -> bool {
        match &self.nodes[node as usize].shape {
            ValidationShape::Unknown | ValidationShape::Undefined => true,
            ValidationShape::Union { arms } => arms.iter().any(|&arm| self.may_be_undefined(arm)),
            _ => false,
        }
    }

    // The other direction: the node refuses no value that is valid under the schema. A keyword that is not looked at only leaves fewer valid values, so it does no harm here.

    /// Schemas that every value at hand is valid under: the schema, the parts of its `allOf`, what it refers to, and the same of those that enclose it.
    fn holders_of(&self, schema: ExprId) -> SmallVec<[ExprId; 4]> {
        let mut holders: SmallVec<[ExprId; 4]> = SmallVec::new();
        let mut seen: SmallVec<[ExprId; 8]> = SmallVec::new();
        let mut pending: SmallVec<[ExprId; 8]> = SmallVec::from_slice(&self.enclosing);
        pending.push(schema);
        while let Some(next) = pending.pop() {
            if seen.contains(&next) || seen.len() >= MAX_SCHEMAS_AT_ONE_VALUE {
                continue;
            }
            seen.push(next);
            if let Some(reference) = self.own(next, b"$ref") {
                pending.extend(self.find_referenced(reference));
                if self.draft == Draft::Draft7 {
                    continue;
                }
            }
            holders.push(next);
            let parts = self.own(next, b"allOf");
            pending.extend(
                parts
                    .and_then(|parts| elements_of(self.hir, parts))
                    .unwrap_or_default(),
            );
        }
        holders
    }

    fn is_stated(
        &mut self,
        schema: ExprId,
        keyword: &[u8],
        mut shows: impl FnMut(&mut Self, ExprId, ExprId) -> bool,
    ) -> bool {
        let holders = self.holders_of(schema);
        self.any_of(&holders, |proof, holder| match proof.own(holder, keyword) {
            Some(written) => shows(proof, holder, written),
            None => false,
        })
    }

    fn takes(&mut self, schema: ExprId, node: u32, steps: u32) -> bool {
        if !self.spend(schema, steps) {
            return false;
        }
        if self.takes_everything(node) {
            return true;
        }
        match literal_of(self.hir, schema) {
            Some(Literal::Boolean(false)) => return true,
            Some(Literal::Boolean(true)) => return self.fail(b"", schema, Reason::TypeRefusesMore),
            Some(_) => return self.fail(b"", schema, Reason::IsNotWrittenOut),
            None => {}
        }
        let Some(keywords) = properties_of(self.hir, schema) else {
            return self.fail(b"", schema, Reason::IsNotWrittenOut);
        };
        if matches!(self.nodes[node as usize].shape, ValidationShape::Unknown) {
            return self.states_rules(schema, node, false, steps);
        }
        let holders = self.holders_of(schema);
        if self.any_of(&holders, |proof, holder| {
            proof.takes_by(schema, holder, node, steps)
        }) {
            return true;
        }
        // No keyword lists what a valid value may be: class by class.
        let classes: SmallVec<[Class; 6]> = match self.class_at_hand {
            Some(class) => SmallVec::from_slice(&[class]),
            None if self.find_what_it_says(&keywords).is_some() => {
                SmallVec::from_slice(&ALL_CLASSES)
            }
            None => SmallVec::new(),
        };
        let arms = self.arms_of(node);
        let takes_each = !classes.is_empty()
            && self.attempt(|proof| {
                (classes.iter())
                    .all(|&class| proof.takes_type_by_arms(name_of(class), schema, &arms, steps))
            });
        takes_each || self.fail(b"", schema, Reason::TypeRefusesMore)
    }

    /// By one keyword of the holder that lists what a valid value may be.
    fn takes_by(&mut self, schema: ExprId, holder: ExprId, node: u32, steps: u32) -> bool {
        let hir = self.hir;
        let allowed = match (self.own(holder, b"const"), self.own(holder, b"enum")) {
            (Some(only), _) => Some(SmallVec::from_slice(&[only])),
            (None, Some(listed)) => elements_of(hir, listed),
            (None, None) => None,
        };
        if let Some(allowed) = allowed
            && self.attempt(|proof| {
                (allowed.iter()).all(|&value| proof.takes_value(schema, value, node, steps))
            })
        {
            return true;
        }
        for alternatives in [&b"anyOf"[..], b"oneOf"] {
            let Some(written) = self.own(holder, alternatives) else {
                continue;
            };
            let Some(alternatives) = elements_of(hir, written) else {
                continue;
            };
            if self.open_alternatives.contains(&written) {
                continue;
            }
            self.open_alternatives.push(written);
            self.enclosing.push(schema);
            let takes_all = self.attempt(|proof| {
                (alternatives.iter()).all(|&one| proof.is_taken_by_an_arm(one, node, steps))
            });
            self.enclosing.pop();
            self.open_alternatives.pop();
            if takes_all {
                return true;
            }
        }
        let Some(written) = self.own(holder, b"type") else {
            return false;
        };
        let one = [written];
        let listed = elements_of(hir, written);
        let names: SmallVec<[ExprId; 4]> = SmallVec::from_slice(listed.as_deref().unwrap_or(&one));
        let arms = self.arms_of(node);
        let class_at_hand = self.class_at_hand;
        let is_at_hand =
            |name: &[u8]| class_at_hand.is_none_or(|class| class_named(name) == Some(class));
        names.iter().all(|&name| {
            let Some(Literal::String(name)) = literal_of(hir, name) else {
                return false;
            };
            let name = self.text(name);
            !is_at_hand(name) || self.takes_type_by_arms(name, schema, &arms, steps)
        })
    }

    // `boolean` under a brand is `true` and `false` under it.
    fn takes_type_by_arms(
        &mut self,
        name: &[u8],
        schema: ExprId,
        arms: &[u32],
        steps: u32,
    ) -> bool {
        if self.any_of(arms, |proof, arm| {
            proof.takes_type(name, schema, arm, steps)
        }) {
            return true;
        }
        name == b"boolean"
            && [true, false].iter().all(|&wanted| {
                self.any_of(arms, |proof, arm| {
                    let shape = &proof.nodes[arm as usize].shape;
                    matches!(*shape, ValidationShape::BooleanLiteral { value } if value == wanted)
                        && proof.states_rules(schema, arm, false, steps)
                })
            })
    }

    fn arms_of(&self, node: u32) -> SmallVec<[u32; 8]> {
        match &self.nodes[node as usize].shape {
            ValidationShape::Union { arms } if self.nodes[node as usize].rules.is_empty() => {
                arms.iter().flat_map(|&arm| self.arms_of(arm)).collect()
            }
            _ => SmallVec::from_slice(&[node]),
        }
    }

    fn is_taken_by_an_arm(&mut self, schema: ExprId, node: u32, steps: u32) -> bool {
        // A schema that lists several types may need several arms: the whole union is asked first.
        let mut ways = self.arms_of(node);
        if ways.as_slice() != [node] {
            ways.insert(0, node);
        }
        self.any_of(&ways, |proof, arm| proof.takes(schema, arm, steps + 1))
    }

    fn takes_value(&mut self, schema: ExprId, value: ExprId, node: u32, steps: u32) -> bool {
        let arms = self.arms_of(node);
        self.any_of(&arms, |proof, arm| {
            proof.accepts_written(value, arm)
                || (proof.is_literal(arm)
                    && proof.is_one_of(arm, &[value])
                    && proof.states_rules(schema, arm, false, steps))
        })
    }

    /// The node accepts the value that is written. A node with rules is not looked into.
    fn accepts_written(&mut self, value: ExprId, node: u32) -> bool {
        let (hir, nodes) = (self.hir, self.nodes);
        if self.takes_everything(node) {
            return true;
        }
        if !nodes[node as usize].rules.is_empty() {
            return false;
        }
        let (members, undeclared, undeclared_value): (&[ValidationMember], _, _) =
            match &nodes[node as usize].shape {
                ValidationShape::Union { arms } => {
                    return arms.iter().any(|&arm| self.accepts_written(value, arm));
                }
                ValidationShape::Primitive { primitive } => {
                    return match (primitive, literal_of(hir, value)) {
                        (ValidatedPrimitive::Boolean, Some(Literal::Boolean(_)))
                        | (ValidatedPrimitive::String, Some(Literal::String(_))) => true,
                        (ValidatedPrimitive::Number, Some(Literal::Number(number))) => {
                            number.is_finite()
                        }
                        _ => false,
                    };
                }
                ValidationShape::Array { element } => {
                    return elements_of(hir, value).is_some_and(|written| {
                        written
                            .iter()
                            .all(|&value| self.accepts_written(value, *element))
                    });
                }
                ValidationShape::Tuple {
                    elements,
                    required,
                    rest,
                } => {
                    return elements_of(hir, value).is_some_and(|written| {
                        written.len() >= *required as usize
                            && written.iter().enumerate().all(|(index, &value)| {
                                match elements.get(index).or(rest.as_ref()) {
                                    Some(&element) => self.accepts_written(value, element),
                                    None => false,
                                }
                            })
                    });
                }
                ValidationShape::Object {
                    members,
                    undeclared,
                    undeclared_value,
                    ..
                } => (&members[..], *undeclared, *undeclared_value),
                ValidationShape::Dictionary { value } => {
                    (&[][..], UndeclaredMembers::Validated, Some(*value))
                }
                _ => return self.is_literal(node) && self.is_one_of(node, &[value]),
            };
        // A key that holds `undefined` makes no difference to `const`, and such a node refuses it.
        if self.source == Source::Value && !matches!(undeclared, UndeclaredMembers::Allowed) {
            return false;
        }
        let Some(written) = self.names_of(b"const", value) else {
            return false;
        };
        let written: SmallVec<[_; 8]> = written
            .iter()
            .map(|&(name, value)| (self.file.name_key(name), value))
            .collect();
        let has_all = members
            .iter()
            .all(|member| member.is_optional || written.iter().any(|&(key, _)| key == member.key));
        has_all
            && written.iter().all(|&(key, value)| {
                match (
                    members.iter().find(|member| member.key == key),
                    undeclared,
                    undeclared_value,
                ) {
                    (Some(member), _, _) => self.accepts_written(value, member.node),
                    (None, UndeclaredMembers::Allowed, _) => true,
                    (None, UndeclaredMembers::Validated, Some(held)) => {
                        self.accepts_written(value, held)
                    }
                    (None, _, _) => false,
                }
            })
    }

    /// Every rule of the node is one that the schema states.
    fn states_rules(&mut self, schema: ExprId, node: u32, is_integer: bool, steps: u32) -> bool {
        let class = self.class_of(node);
        // Of a literal that is whole, `Integer` refuses nothing.
        let is_literal = matches!(
            self.nodes[node as usize].shape,
            ValidationShape::NumberLiteral { .. }
        );
        let is_integer = is_integer || (is_literal && self.is_integer(node));
        self.rules_of(node).iter().all(|rule| {
            self.attempt(|proof| proof.states_rule(schema, rule, class, is_integer, steps + 1))
                || self.fail(keyword_of(rule), schema, Reason::TypeRefusesMore)
        })
    }

    fn states_rule(
        &mut self,
        schema: ExprId,
        rule: &'n ValidationRule,
        class: Option<Class>,
        is_integer: bool,
        steps: u32,
    ) -> bool {
        let hir = self.hir;
        // What such a rule says of a value of another class is not written down: it is looked at on a node of its own class alone.
        let number = |proof: &mut Self, keyword: &[u8], wanted: f64| {
            class == Some(Class::Number)
                && proof.is_stated(schema, keyword, |_, _, written| {
                    number_of(hir, written) == Some(wanted)
                })
        };
        let length = |proof: &mut Self, keywords: [&[u8]; 2], wanted: u32| {
            let keyword = match class {
                Some(Class::String) => keywords[0],
                Some(Class::Array) => keywords[1],
                _ => return false,
            };
            proof.is_stated(schema, keyword, |_, _, written| {
                count_of(hir, written) == Some(wanted)
            })
        };
        let is_2020 = self.draft == Draft::Draft2020;
        match rule {
            ValidationRule::Integer { .. } => class == Some(Class::Number) && is_integer,
            ValidationRule::Minimum { bound } => number(self, b"minimum", *bound),
            ValidationRule::Maximum { bound } => number(self, b"maximum", *bound),
            ValidationRule::ExclusiveMinimum { bound } => number(self, b"exclusiveMinimum", *bound),
            ValidationRule::ExclusiveMaximum { bound } => number(self, b"exclusiveMaximum", *bound),
            // The remainder of a division by a whole number is exact.
            ValidationRule::MultipleOf { divisor } => {
                divisor.fract() == 0.0 && number(self, b"multipleOf", *divisor)
            }
            ValidationRule::MinimumLength { length: wanted } => {
                length(self, [b"minLength", b"minItems"], *wanted)
            }
            ValidationRule::MaximumLength { length: wanted } => {
                length(self, [b"maxLength", b"maxItems"], *wanted)
            }
            ValidationRule::Pattern { source, is_unicode } => {
                *is_unicode
                    && class == Some(Class::String)
                    && self.is_stated(schema, b"pattern", |proof, _, written| {
                        match literal_of(hir, written) {
                            Some(Literal::String(text)) => proof.file.intern_atom(text) == *source,
                            _ => false,
                        }
                    })
            }
            ValidationRule::Format { format } => {
                self.asserts_formats
                    && class == Some(Class::String)
                    && self.is_stated(schema, b"format", |proof, _, written| {
                        match literal_of(hir, written) {
                            Some(Literal::String(name)) => {
                                format_named(proof.text(name)) == Some(*format)
                            }
                            _ => false,
                        }
                    })
            }
            ValidationRule::UniqueItems { .. } => {
                self.is_stated(schema, b"uniqueItems", |_, _, written| {
                    literal_of(hir, written) == Some(Literal::Boolean(true))
                })
            }
            ValidationRule::Contains { .. } => {
                self.is_stated(schema, b"contains", |proof, holder, written| {
                    let context = proof.keywords_of(holder);
                    proof.counts_the_same(Direction::Takes, written, &context, rule)
                })
            }
            ValidationRule::Not { node } => self.is_stated(schema, b"not", |proof, _, written| {
                proof.holds(written, *node, steps)
            }),
            ValidationRule::If {
                condition,
                then,
                otherwise,
            } => self.is_stated(schema, b"if", |proof, holder, written| {
                let takes_branch = |proof: &mut Self, keyword: &[u8], node: u32| match proof
                    .own(holder, keyword)
                {
                    Some(branch) => proof.takes(branch, node, steps),
                    None => proof.takes_everything(node),
                };
                proof.is_same(written, *condition, steps)
                    && takes_branch(proof, b"then", *then)
                    && takes_branch(proof, b"else", *otherwise)
            }),
            ValidationRule::ExactlyOne { nodes } => {
                self.is_stated(schema, b"oneOf", |proof, _, written| {
                    elements_of(hir, written)
                        .is_some_and(|arms| proof.are_same(&arms, nodes, steps))
                })
            }
            ValidationRule::Every { nodes } => {
                let holders = self.holders_of(schema);
                nodes.iter().all(|&one| {
                    self.any_of(&holders, |proof, holder| proof.takes(holder, one, steps))
                })
            }
            ValidationRule::PatternMembers { sources, nodes } => {
                sources.len() == nodes.len()
                    && sources.iter().zip(nodes).all(|(&source, &held)| {
                        self.takes_everything(held)
                            || self.is_stated(schema, b"patternProperties", |proof, _, written| {
                                let Some(patterns) = proof.names_of(b"patternProperties", written)
                                else {
                                    return false;
                                };
                                patterns.iter().any(|&(text, pattern)| {
                                    proof.file.intern_atom(text) == source
                                        && proof.attempt(|proof| proof.takes_below(pattern, held))
                                })
                            })
                    })
            }
            ValidationRule::MemberNames { node } => {
                self.is_stated(schema, b"propertyNames", |proof, _, written| {
                    proof.takes_below(written, *node)
                })
            }
            ValidationRule::MinimumMembers { count } => {
                *count == 0
                    || self.is_stated(schema, b"minProperties", |_, _, written| {
                        count_of(hir, written).is_some_and(|stated| stated >= *count)
                    })
            }
            ValidationRule::MaximumMembers { count } => {
                self.is_stated(schema, b"maxProperties", |_, _, written| {
                    count_of(hir, written).is_some_and(|stated| stated <= *count)
                })
            }
            ValidationRule::DependentMembers { key, names } => {
                let keyword: &'static [u8] = match is_2020 {
                    true => b"dependentRequired",
                    false => b"dependencies",
                };
                self.is_stated(schema, keyword, |proof, _, written| {
                    let Some(dependents) = proof.names_of(keyword, written) else {
                        return false;
                    };
                    dependents.iter().any(|&(name, listed)| {
                        let Some(listed) = elements_of(hir, listed) else {
                            return false;
                        };
                        proof.file.intern_atom(name) == *key
                            && names.iter().all(|&wanted| {
                                listed.iter().any(|&it| match literal_of(hir, it) {
                                    Some(Literal::String(it)) => {
                                        proof.file.intern_atom(it) == wanted
                                    }
                                    _ => false,
                                })
                            })
                    })
                })
            }
            ValidationRule::DependentNode { key, node } => {
                let keyword: &'static [u8] = match is_2020 {
                    true => b"dependentSchemas",
                    false => b"dependencies",
                };
                self.is_stated(schema, keyword, |proof, _, written| {
                    let Some(dependents) = proof.names_of(keyword, written) else {
                        return false;
                    };
                    dependents.iter().any(|&(name, dependent)| {
                        elements_of(hir, dependent).is_none()
                            && proof.file.intern_atom(name) == *key
                            && proof.attempt(|proof| proof.takes(dependent, *node, steps))
                    })
                })
            }
            // No keyword states them.
            ValidationRule::Template { .. }
            | ValidationRule::Message { .. }
            | ValidationRule::DefaultNull { .. }
            | ValidationRule::DefaultBoolean { .. }
            | ValidationRule::DefaultNumber { .. }
            | ValidationRule::DefaultString { .. } => false,
        }
    }

    /// For the valid values of the type that is named.
    fn takes_type(&mut self, name: &[u8], schema: ExprId, node: u32, steps: u32) -> bool {
        let class = class_named(name).or(self.class_at_hand);
        let outer = std::mem::replace(&mut self.class_at_hand, class);
        let takes = self.takes_values_of_type(name, schema, node, steps);
        self.class_at_hand = outer;
        takes
    }

    fn takes_values_of_type(&mut self, name: &[u8], schema: ExprId, node: u32, steps: u32) -> bool {
        let nodes = self.nodes;
        if !self.states_rules(schema, node, name == b"integer", steps) {
            return false;
        }
        match (name, &nodes[node as usize].shape) {
            (_, ValidationShape::Unknown) | (b"null", ValidationShape::Null) => true,
            (_, ValidationShape::Primitive { primitive }) => match primitive {
                ValidatedPrimitive::Boolean => name == b"boolean",
                ValidatedPrimitive::String => name == b"string",
                ValidatedPrimitive::Number => name == b"number" || name == b"integer",
                ValidatedPrimitive::BigInt => false,
            },
            (b"array", ValidationShape::Array { element }) => {
                self.takes_elements(schema, &[], 0, Some(*element))
            }
            (
                b"array",
                ValidationShape::Tuple {
                    elements,
                    required,
                    rest,
                },
            ) => self.takes_elements(schema, elements, *required, *rest),
            (
                b"object",
                ValidationShape::Object {
                    members,
                    undeclared,
                    undeclared_value,
                    ..
                },
            ) => self.takes_members(schema, node, members, *undeclared, *undeclared_value),
            (b"object", ValidationShape::Dictionary { value })
                if !self.has_pattern_members(node) =>
            {
                self.takes_members(
                    schema,
                    node,
                    &[],
                    UndeclaredMembers::Validated,
                    Some(*value),
                )
            }
            _ => false,
        }
    }

    fn takes_elements(
        &mut self,
        schema: ExprId,
        elements: &[u32],
        required: u32,
        rest: Option<u32>,
    ) -> bool {
        let hir = self.hir;
        let is_long_enough = required == 0
            || self.is_stated(schema, b"minItems", |_, _, written| {
                count_of(hir, written).is_some_and(|stated| stated >= required)
            });
        if !is_long_enough {
            return self.fail(b"minItems", schema, Reason::TypeRefusesMore);
        }
        let holders = self.holders_of(schema);
        let takes_each = elements.iter().enumerate().all(|(index, &element)| {
            self.takes_everything(element)
                || self.any_of(&holders, |proof, holder| {
                    let context = proof.keywords_of(holder);
                    let Some((positional, behind)) = proof.positions_of(&context) else {
                        return false;
                    };
                    match positional.get(index).copied().or(behind) {
                        Some(stated) => proof.takes_below(stated, element),
                        None => false,
                    }
                })
        });
        if !takes_each {
            return false;
        }
        // What the holder says of every element behind its positions, it says of every element behind the node's.
        let says_of_the_rest =
            |proof: &mut Self, shows: &mut dyn FnMut(&mut Self, ExprId) -> bool| {
                proof.any_of(&holders, |proof, holder| {
                    let context = proof.keywords_of(holder);
                    match proof.positions_of(&context) {
                        Some((positional, Some(behind))) => {
                            positional.len() <= elements.len() && shows(proof, behind)
                        }
                        _ => false,
                    }
                })
            };
        match rest {
            Some(rest) => {
                self.takes_everything(rest)
                    || says_of_the_rest(self, &mut |proof: &mut Self, behind: ExprId| {
                        proof.takes_below(behind, rest)
                    })
            }
            None => {
                says_of_the_rest(self, &mut |_: &mut Self, behind: ExprId| {
                    literal_of(hir, behind) == Some(Literal::Boolean(false))
                }) || self.is_stated(schema, b"maxItems", |_, _, written| {
                    count_of(hir, written).is_some_and(|stated| stated as usize <= elements.len())
                })
            }
        }
    }

    fn takes_members(
        &mut self,
        schema: ExprId,
        node: u32,
        members: &[ValidationMember],
        undeclared: UndeclaredMembers,
        undeclared_value: Option<u32>,
    ) -> bool {
        let hir = self.hir;
        let holders = self.holders_of(schema);
        // A key that is undeclared to the node is additional to the holder.
        let declares_no_more = |proof: &mut Self, holder: ExprId| {
            let mut read = |keyword: &'static [u8]| match proof.own(holder, keyword) {
                Some(written) => proof.names_of(keyword, written),
                None => Some(Properties::new()),
            };
            let (Some(declared), Some(patterns)) =
                (read(b"properties"), read(b"patternProperties"))
            else {
                return false;
            };
            declared.iter().all(|&(name, _)| {
                let key = proof.file.name_key(name);
                members.iter().any(|member| member.key == key)
            }) && patterns
                .iter()
                .all(|&(source, _)| proof.is_pattern_of(node, source))
        };
        let takes_others = match (undeclared, undeclared_value) {
            (UndeclaredMembers::Allowed, _) => true,
            (UndeclaredMembers::Rejected, _) => self.any_of(&holders, |proof, holder| {
                (proof.own(holder, b"additionalProperties"))
                    .is_some_and(|it| literal_of(hir, it) == Some(Literal::Boolean(false)))
                    && declares_no_more(proof, holder)
            }),
            (UndeclaredMembers::Validated, Some(value)) => {
                self.takes_everything(value)
                    || self.any_of(&holders, |proof, holder| {
                        match proof.own(holder, b"additionalProperties") {
                            Some(additional) => {
                                declares_no_more(proof, holder)
                                    && proof.takes_below(additional, value)
                            }
                            None => false,
                        }
                    })
            }
            (UndeclaredMembers::Validated, None) => false,
        };
        if !takes_others {
            return self.fail(b"additionalProperties", schema, Reason::TypeRefusesMore);
        }
        members.iter().all(|member| {
            let is_there = member.is_optional
                || self.is_stated(schema, b"required", |proof, _, written| {
                    elements_of(hir, written).is_some_and(|required| {
                        required.iter().any(|&name| match literal_of(hir, name) {
                            Some(Literal::String(name)) => proof.file.name_key(name) == member.key,
                            _ => false,
                        })
                    })
                });
            if !is_there {
                return self.fail(b"required", schema, Reason::TypeRefusesMore);
            }
            self.takes_everything(member.node)
                || self.is_stated(schema, b"properties", |proof, _, written| {
                    let Some(declared) = proof.names_of(b"properties", written) else {
                        return false;
                    };
                    let stated = declared
                        .iter()
                        .find(|&&(name, _)| proof.file.name_key(name) == member.key);
                    let Some(&(_, stated)) = stated else {
                        return false;
                    };
                    match proof.arms_of_member(member).as_slice() {
                        &[only] => proof.takes_below(stated, only),
                        _ => proof.takes_below(stated, member.node),
                    }
                })
                || self.fail(b"properties", schema, Reason::TypeRefusesMore)
        })
    }

    fn is_literal(&self, node: u32) -> bool {
        matches!(
            self.nodes[node as usize].shape,
            ValidationShape::Null
                | ValidationShape::BooleanLiteral { .. }
                | ValidationShape::NumberLiteral { .. }
                | ValidationShape::StringLiteral { .. }
        )
    }
}

struct Keywords {
    properties: Option<ExprId>,
    pattern_properties: Option<ExprId>,
    prefix_items: Option<ExprId>,
    items: Option<ExprId>,
    additional_items: Option<ExprId>,
    contains: Option<ExprId>,
    min_contains: Option<ExprId>,
    max_contains: Option<ExprId>,
    condition: Option<ExprId>,
    then: Option<ExprId>,
    otherwise: Option<ExprId>,
    is_root: bool,
}
