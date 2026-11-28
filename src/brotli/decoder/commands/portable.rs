//! The fast loops for CPUs that the assembly is not for.

use bun_highway::brotli_decoder::{ContextParts, Distance, Root, Symbol, SymbolTree};

use super::{
    Command, Cursor, FORMAT, LiteralTrees, Phase, Stopped, Tables, TreesByContext, bits_in,
    distance_of, write_word,
};
use crate::decoder::Stop;
use crate::decoder::bit_reader::{BitReader, FastReader, REFILLED};
use crate::decoder::ring_buffer::{self, WIDE_CHUNK};
use crate::{DecodeError, transform};

const IS_NEEDED: bool = cfg!(any(target_arch = "x86_64", miri));

/// Decodes the commands that are clear of the ends of the input, the blocks, the meta-block and the ring.
#[inline(never)]
pub(super) fn run(
    tables: &Tables<'_>,
    trees: &impl LiteralTrees,
    cursor: &mut Cursor,
    whole_input: &mut BitReader<'_>,
    whole_ring: &mut [u8],
) -> Stopped {
    /// Looking a symbol up in a root does not wait for the next word, so each step leaves enough bits for that.
    const MAX_STEP: u32 = REFILLED - Root::Bits10.bits();
    const MAX_USED: u32 = u64::BITS - Root::Bits10.bits();
    /// More are worth leaving for [`read_many_literals`].
    const MAX_INSERT: u32 = 321;

    IS_NEEDED.then_some(())?;
    let [literals, commands, distances] = &mut cursor.blocks;
    let command_root = tables.codes.command_root;
    let command_tree = tables.codes.commands.entries_of(commands.current()).ok()?;
    let in_command_root = command_tree.get(..=command_root as usize)?;
    let distance_map = *tables.codes.distance_map.of(distances.current());
    let [a, b, c, d] = distance_map;
    let tree = |index| tables.codes.distances.entries_of(usize::from(index)).ok();
    let root = |index| tree(index)?.first_chunk::<256>();
    let distance_roots = [root(a)?, root(b)?, root(c)?, root(d)?];
    let (literal_root, parts) = (
        tables.codes.literal_root,
        tables.codes.mode_in_trees.parts(),
    );
    let max_distance = tables.max_backward_distance;
    let limit = tables.clear_end() as u32 as usize;
    let mut reader = whole_input.begin_reloading()?;
    let mut position = cursor.position as u32;
    let mut literals_left = literals.remaining;
    let mut recent = cursor.recent;
    let at_most = commands.remaining.min(distances.remaining);
    let (mut left, mut without_distance) = (at_most, 0);
    // Up to there, words fit, and a distance beyond the start of the ring leads to one.
    let words_end = if tables.last_lap == 0 && tables.padded_dictionary.is_empty() {
        limit.min(max_distance).saturating_sub(transform::ROOM)
    } else {
        0
    };

    let stopped = loop {
        let Some(ring) = whole_ring.get_mut(..limit + ring_buffer::SLACK) else {
            break None;
        };
        let Some(mut command) = in_command_root.get(reader.peek() as usize & command_root as usize)
        else {
            break None;
        };
        if left == 0 {
            break None;
        }
        let Some(word) = reader.reload() else {
            break None;
        };
        let start = reader.used();
        if command.total_length() > MAX_STEP {
            core::hint::cold_path();
            match command.resolve(command_tree, command_root, word >> start) {
                Some(resolved) if resolved.total_length() <= MAX_STEP => command = resolved,
                _ => break None,
            }
        }
        let (insert_end, context) = (start + command.insert_end(), command.distance_context());
        reader.skip_in(word, command.total_length());
        let copy = command.min_copy() + bits_in(word, insert_end, reader.used());
        left -= 1;

        let mut interrupt = |phase, unwritten_literals| {
            cursor.command = Command {
                phase,
                distance_context: context,
                unwritten_literals,
                copy_length: copy,
            };
            without_distance += 1;
        };
        if command.insert_code() != 0 {
            let [insert, extra_bits] = FORMAT.insert(command.insert_code());
            let insert = insert + bits_in(word, insert_end - extra_bits, insert_end);
            let copy_start = position + insert;
            if copy_start as usize >= limit || insert > literals_left || insert > MAX_INSERT {
                interrupt(Phase::Literals, insert);
                break None;
            }
            literals_left -= insert;
            position = read_literals(
                parts,
                trees,
                literal_root,
                &mut reader,
                ring,
                position,
                copy_start,
            );
            if position != copy_start {
                literals_left += copy_start - position;
                interrupt(Phase::Literals, copy_start - position);
                break None;
            }
        }
        let (target, length) = (position as usize, copy as usize);
        if target + length >= limit {
            interrupt(Phase::Distance, 0);
            break None;
        }

        let (distance, is_repeat) = match distance_roots.get(context as usize) {
            None => {
                without_distance += 1;
                (recent.get(0), true)
            }
            Some(root) => {
                let mut bits = reader.peek();
                #[allow(clippy::indexing_slicing)] // A `u8` into 256 entries.
                let mut entry: &Distance = &root[usize::from(bits as u8)];
                if entry.total_length() + reader.used() > MAX_USED {
                    core::hint::cold_path();
                    if let Some(word) = reader.reload()
                        && let Some(tree) =
                            distance_map.get(context as usize).and_then(|&it| tree(it))
                        && let Some(resolved) = entry.resolve(tree, word >> reader.used())
                        && resolved.total_length() <= MAX_STEP
                    {
                        reader.skip_in(word, 0);
                        (entry, bits) = (resolved, reader.peek());
                    } else {
                        interrupt(Phase::Distance, 0);
                        break None;
                    }
                }
                reader.skip(entry.total_length());
                distance_of(entry, bits, tables, &recent)
            }
        };

        let back = distance as usize;
        if let Some(source) = target.checked_sub(back)
            && back <= max_distance
        {
            recent.push(distance, is_repeat);
            let copied = if length <= WIDE_CHUNK && length <= back {
                ring_buffer::copy_chunk::<WIDE_CHUNK>(ring, source, target)
            } else {
                ring_buffer::copy(ring, source, target, back, length)
            };
            if copied.is_none() {
                break Some(Err(match back {
                    0 => DecodeError::Distance.into(),
                    _ => Stop::UNREACHABLE,
                }));
            }
            position += copy;
        } else {
            core::hint::cold_path();
            if target < words_end
                && let Ok(written) = write_word(ring, target, length, back - target - 1)
            {
                position += written as u32;
                continue;
            }
            (cursor.position, cursor.recent) = (target, recent);
            let stopped = cursor.copy(tables, whole_ring, distance, is_repeat, length);
            (position, recent) = (cursor.position as u32, cursor.recent);
            if stopped.is_some() {
                break stopped;
            }
        }
    };
    (cursor.position, cursor.recent) = (position as usize, recent);
    let [literals, commands, distances] = &mut cursor.blocks;
    literals.remaining = literals_left;
    commands.remaining -= at_most - left;
    distances.remaining -= at_most - left - without_distance;
    whole_input.end_reloading(&reader);
    stopped
}

/// From `position`, which is in `2..end`. Returns `end` unless the input ends soon.
#[inline(always)]
fn read_literals<T: LiteralTrees>(
    parts: &ContextParts,
    trees: &T,
    root: Root,
    reader: &mut impl FastReader,
    ring: &mut [u8],
    position: u32,
    end: u32,
) -> u32 {
    let [mut context, mut next_part] = [0; 2];
    if T::IN_CONTEXT {
        let at = position.wrapping_sub(2) as usize;
        let Some(&[second_last, last]) = ring.get(at..at + 2) else {
            return position;
        };
        [context, next_part] = parts.of(last).map(u32::from);
        context |= u32::from(parts.of(second_last)[1]);
    }
    let Some([first, rest @ ..]) = ring.get_mut(position as usize..end as usize) else {
        return position;
    };
    let (mut slot, mut rest) = (first, rest.iter_mut());
    let mut read = {
        #[inline(always)]
        |needs_input| {
            let tree = trees.of(context);
            let in_root = Symbol::in_root(tree, root, reader.peek());
            let resolve = {
                #[inline(always)]
                |bits| {
                    let symbol = in_root.resolve(tree, root, bits);
                    (symbol, symbol.length())
                }
            };
            let symbol = if needs_input {
                reader.step(resolve)?
            } else {
                let (symbol, length) = resolve(reader.peek());
                reader.skip(length);
                symbol
            };
            let [last, second_last] = symbol.context_parts();
            (context, next_part) = (last | next_part, second_last);
            Some(symbol.literal().0)
        }
    };
    loop {
        // That leaves enough bits to look a fourth code up in the root.
        let Some(literal) = read(true) else {
            return end - 1 - rest.len() as u32;
        };
        *slot = literal;
        let mut go_on = {
            #[inline(always)]
            || {
                let second = rest.next()?;
                *second = read(false)?;
                let third = rest.next()?;
                *third = read(false)?;
                rest.next()
            }
        };
        let Some(next) = go_on() else {
            return end;
        };
        slot = next;
    }
}

/// See [`read_literals`].
#[inline(never)]
pub(super) fn read_many_literals(
    tables: &Tables<'_>,
    tree: &SymbolTree,
    trees: Option<&TreesByContext<'_>>,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
    [start, end]: [u32; 2],
) -> usize {
    let Some(mut fast) = reader.begin_refilling().filter(|_| IS_NEEDED) else {
        return start as usize;
    };
    let (literal_root, parts) = (
        tables.codes.literal_root,
        tables.codes.mode_in_trees.parts(),
    );
    let position = match trees {
        None => read_literals(parts, tree, literal_root, &mut fast, ring, start, end),
        Some(trees) => read_literals(parts, trees, literal_root, &mut fast, ring, start, end),
    };
    reader.end_refilling(&fast);
    position as usize
}
