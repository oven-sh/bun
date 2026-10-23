//! What a JavaScript rule can learn from `parserServices.getTypeAtLocation(node)` and `checker.getTypeAtLocation(node)`.
//!
//! A rule runs on a thread that has a realm, and the type checker belongs to the thread that checked the file. So the
//! answers are computed up front, for every expression of a file on which a rule runs that has asked for types before.
//! `typedServices` in `worker/main.js` makes objects that look like TypeScript's from them. Whatever else a rule reads
//! from these objects is refused by name: see [`Host::asks_for_types`](super::Host::asks_for_types).

use super::ast;
use crate::ast::File;
use crate::types::TypeFlags;
use bun_core::strings::Utf16OffsetTable;
use rustc_hash::FxHashMap;

/// `ts.TypeFlags` before TypeScript 6, by the bit of [`TypeFlags`], which has the values of TypeScript 6 and later.
const FLAGS_BEFORE_TYPESCRIPT_6: [(TypeFlags, u32); 29] = [
    (TypeFlags::ANY, 1 << 0),
    (TypeFlags::UNKNOWN, 1 << 1),
    (TypeFlags::STRING, 1 << 2),
    (TypeFlags::NUMBER, 1 << 3),
    (TypeFlags::BOOLEAN, 1 << 4),
    (TypeFlags::ENUM, 1 << 5),
    (TypeFlags::BIG_INT, 1 << 6),
    (TypeFlags::STRING_LITERAL, 1 << 7),
    (TypeFlags::NUMBER_LITERAL, 1 << 8),
    (TypeFlags::BOOLEAN_LITERAL, 1 << 9),
    (TypeFlags::ENUM_LITERAL, 1 << 10),
    (TypeFlags::BIG_INT_LITERAL, 1 << 11),
    (TypeFlags::ES_SYMBOL, 1 << 12),
    (TypeFlags::UNIQUE_ES_SYMBOL, 1 << 13),
    (TypeFlags::VOID, 1 << 14),
    (TypeFlags::UNDEFINED, 1 << 15),
    (TypeFlags::NULL, 1 << 16),
    (TypeFlags::NEVER, 1 << 17),
    (TypeFlags::TYPE_PARAMETER, 1 << 18),
    (TypeFlags::OBJECT, 1 << 19),
    (TypeFlags::UNION, 1 << 20),
    (TypeFlags::INTERSECTION, 1 << 21),
    (TypeFlags::INDEX, 1 << 22),
    (TypeFlags::INDEXED_ACCESS, 1 << 23),
    (TypeFlags::CONDITIONAL, 1 << 24),
    (TypeFlags::SUBSTITUTION, 1 << 25),
    (TypeFlags::NON_PRIMITIVE, 1 << 26),
    (TypeFlags::TEMPLATE_LITERAL, 1 << 27),
    (TypeFlags::STRING_MAPPING, 1 << 28),
];

/// Which `ts.TypeFlags` the project's rules compare `type.flags` with: those of the `typescript` they import.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum FlagValues {
    BeforeTypeScript6,
    #[default]
    SinceTypeScript6,
}

impl FlagValues {
    fn of(self, flags: TypeFlags) -> u32 {
        let known = FLAGS_BEFORE_TYPESCRIPT_6.iter();
        let set = known.filter(|it| flags.contains(it.0));
        match self {
            FlagValues::BeforeTypeScript6 => set.fold(0, |all, it| all | it.1),
            FlagValues::SinceTypeScript6 => set.fold(0, |all, it| all | it.0.bits()),
        }
    }
}

/// What rules can learn about the types in a file.
#[derive(Default)]
pub(super) struct Types {
    /// The answer to [`ask::TYPES`](super::wire::ask::TYPES).
    pub(super) words: Vec<u32>,
    /// The answer to [`ask::TYPE_NAMES`](super::wire::ask::TYPE_NAMES).
    pub(super) names: Vec<u8>,
}

impl Types {
    /// Appends seven words for each expression and import specifier of `file`, which has types: the start and the end
    /// of its `range`, its [`NodeType`](crate::estree::NodeType), `type.flags`, the lengths of
    /// `type.getCallSignatures()` and `type.getConstructSignatures()`, and which of the names `type.symbol.name` is,
    /// counted from 1, or 0 without a symbol. They're sorted.
    pub(super) fn add_nodes<'a>(&mut self, file: &'a File<'a>, flag_values: FlagValues) {
        let offsets = Utf16OffsetTable::without_bom(file.text());
        let writer = ast::walk(file, &offsets, &[]);
        let mut numbers: FxHashMap<&[u8], u32> = FxHashMap::default();
        let mut rows: Vec<[u32; 7]> = (writer.view().nodes.iter())
            .filter_map(|node| {
                let ty = node.type_at_location()?;
                let (node_type, span) = node.type_and_span();
                let name = ty.symbol().map_or(0, |symbol| {
                    let next = numbers.len() as u32 + 1;
                    *numbers.entry(symbol.name()).or_insert_with(|| {
                        self.names.extend_from_slice(symbol.name());
                        self.names.push(0);
                        next
                    })
                });
                Some([
                    offsets.to_utf16(span.start),
                    offsets.to_utf16(span.end),
                    node_type as u32,
                    flag_values.of(ty.flags()),
                    ty.get_call_signatures().len() as u32,
                    ty.get_construct_signatures().len() as u32,
                    name,
                ])
            })
            .collect();
        rows.sort_unstable();
        self.words.extend(rows.iter().flatten());
    }
}
