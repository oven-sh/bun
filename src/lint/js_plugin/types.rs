//! What a JavaScript rule can learn from `parserServices.getTypeAtLocation(node)` and `checker.getTypeAtLocation(node)`.
//!
//! A rule runs on a thread that has a realm, and the type checker belongs to the thread that checked the file. So the
//! answers are computed up front, in a file on which a rule runs that has asked for types before. To find the type of a
//! node takes far longer than anything else here, so that's done for the [kinds](NodeKind) of node that rules have wanted the
//! type of so far.
//! `typedServices` in `worker/main.js` makes objects that look like TypeScript's from them. Whatever else a rule reads
//! from these objects is refused by name, for the file: see [`Host::refuse`](super::Host::refuse).

use super::ast;
use crate::ast::File;
use crate::estree::TypeAtLocation;
use crate::types::{Type, TypeFlags};
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

/// `flags` as TypeScript 6 and later number them, and as the versions before do.
fn in_both_numberings(flags: TypeFlags) -> [u32; 2] {
    let known = FLAGS_BEFORE_TYPESCRIPT_6.iter();
    let set = known.filter(|it| flags.contains(it.0));
    set.fold([0, 0], |all, it| [all[0] | it.0.bits(), all[1] | it.1])
}

/// The [`NodeType`](crate::estree::NodeType) of a node and that of its parent, which for the `Program` is itself.
pub(super) type NodeKind = [u8; 2];

/// What rules can learn about the types in a file.
#[derive(Default)]
pub(super) struct Types {
    /// The answer to [`ask::TYPES`](super::wire::ask::TYPES).
    pub(super) words: Vec<u32>,
    /// The answer to [`ask::TYPE_NAMES`](super::wire::ask::TYPE_NAMES).
    pub(super) names: Vec<u8>,
}

impl Types {
    /// Appends eight words for each node of `file` that [has a type](crate::estree::VNode::type_at_location): the start
    /// and the end of its `range`, its [`NodeType`](crate::estree::NodeType), `type.flags` [twice](in_both_numberings),
    /// the lengths of `type.getCallSignatures()` and `type.getConstructSignatures()`, and which of the names
    /// `type.symbol.name` is, counted from 1, or 0 without a symbol. They're sorted. With `kinds`, which is sorted too,
    /// only for nodes of these kinds.
    pub(super) fn add_nodes<'a>(&mut self, file: &'a File<'a>, kinds: Option<&[NodeKind]>) {
        let offsets = Utf16OffsetTable::without_bom(file.text());
        let writer = ast::walk(file, &offsets, &[]);
        let tree = writer.view();
        let type_of = |at: u32| tree.types.get(at as usize).copied().unwrap_or_default();
        let mut numbers: FxHashMap<&[u8], u32> = FxHashMap::default();
        let mut rows: Vec<[u32; 8]> = (0..)
            .zip(tree.nodes)
            .zip(tree.parents)
            .filter(|&((at, _), &parent)| {
                kinds.is_none_or(|it| it.binary_search(&[type_of(at), type_of(parent)]).is_ok())
            })
            .filter_map(|((_, node), _)| {
                let ty = match node.type_at_location() {
                    TypeAtLocation::Type(ty) => Some(ty),
                    TypeAtLocation::Error => None,
                    TypeAtLocation::Unknown => return None,
                };
                let (node_type, span) = node.type_and_span();
                let name = ty.and_then(Type::symbol).map_or(0, |symbol| {
                    let next = numbers.len() as u32 + 1;
                    *numbers.entry(symbol.name()).or_insert_with(|| {
                        self.names.extend_from_slice(symbol.name());
                        self.names.push(0);
                        next
                    })
                });
                let [flags, flags_before_6] =
                    in_both_numberings(ty.map_or(TypeFlags::ANY, Type::flags));
                Some([
                    offsets.to_utf16(span.start),
                    offsets.to_utf16(span.end),
                    node_type as u32,
                    flags,
                    flags_before_6,
                    ty.map_or(0, |it| it.get_call_signatures().len() as u32),
                    ty.map_or(0, |it| it.get_construct_signatures().len() as u32),
                    name,
                ])
            })
            .collect();
        rows.sort_unstable();
        self.words.extend(rows.iter().flatten());
    }
}
