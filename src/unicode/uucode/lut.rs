// Based on the algorithm described here:
// https://here-be-braces.com/fast-lookup-of-unicode-properties/

use bun_collections::HashMap;
// TODO(port): confirm bun_collections::HashMap exposes a std-compatible Entry API
use bun_collections::hash_map::Entry;

/// Zig `u21` has no Rust equivalent; codepoints are carried as `u32` and
/// range-asserted at the boundary.
const MAX_U21: u32 = (1 << 21) - 1;

const BLOCK_SIZE: usize = 256;
type Block = [u8; BLOCK_SIZE];

/// Context trait for `Generator`. Mirrors the Zig duck-typed `Context` param,
/// which must provide:
///   - `get(Context, u21) Elem`: returns the mapping for a given codepoint
///   - `eql(Context, Elem, Elem) bool`: returns true if two mappings are equal
pub trait GeneratorContext<Elem> {
    fn get(&self, cp: u32) -> Result<Elem, bun_core::Error>;
    fn eql(&self, a: &Elem, b: &Elem) -> bool;
}

/// Creates a type that is able to generate a 3-level lookup table
/// from a Unicode codepoint to a mapping of type Elem.
///
/// Context must have two functions:
///   - `get(Context, u21) Elem`: returns the mapping for a given codepoint
///   - `eql(Context, Elem, Elem) bool`: returns true if two mappings are equal
///
pub struct Generator<Elem, Context: GeneratorContext<Elem>> {
    pub ctx: Context,
    _elem: core::marker::PhantomData<Elem>,
}

impl<Elem: Clone, Context: GeneratorContext<Elem>> Generator<Elem, Context> {
    // Zig's `BlockMap` is a `std.HashMap(Block, u16, ...)` with a hand-written
    // Wyhash context over the raw bytes and `std.mem.eql(u8, ...)` equality.
    // `bun_collections::HashMap<[u8; 256], u16>` is wyhash-backed and `[u8; N]`
    // already hashes/compares bytewise, so the custom context collapses away.

    // TODO(port): narrow error set (Zig inferred set: ctx.get's error ∪ OOM ∪ {BlockTooLarge, Stage2TooLarge})
    pub fn generate(&self) -> Result<Tables<Elem>, bun_core::Error> {
        let mut blocks_map: HashMap<Block, u16> = HashMap::default();

        let mut stage1: Vec<u16> = Vec::new();
        let mut stage2: Vec<u8> = Vec::new();
        let mut stage3: Vec<Elem> = Vec::new();

        let mut block: Block = [0u8; BLOCK_SIZE];
        let mut block_len: u16 = 0;
        for cp in 0u32..=MAX_U21 {
            let elem = self.ctx.get(cp)?;
            let block_idx = 'block_idx: {
                for (i, item) in stage3.iter().enumerate() {
                    if self.ctx.eql(item, &elem) {
                        break 'block_idx i;
                    }
                }

                let idx = stage3.len();
                stage3.push(elem);
                break 'block_idx idx;
            };

            block[block_len as usize] =
                u8::try_from(block_idx).map_err(|_| bun_core::err!("BlockTooLarge"))?;
            block_len += 1;

            if (block_len as usize) < BLOCK_SIZE && cp != MAX_U21 {
                continue;
            }
            if (block_len as usize) < BLOCK_SIZE {
                block[block_len as usize..BLOCK_SIZE].fill(0);
            }

            let stage1_value = match blocks_map.entry(block) {
                Entry::Occupied(e) => *e.get(),
                Entry::Vacant(e) => {
                    let v = u16::try_from(stage2.len())
                        .map_err(|_| bun_core::err!("Stage2TooLarge"))?;
                    for entry in &block[0..block_len as usize] {
                        stage2.push(*entry);
                    }
                    *e.insert(v)
                }
            };

            stage1.push(stage1_value);
            block_len = 0;
        }

        debug_assert!(stage1.len() <= u16::MAX as usize);
        debug_assert!(stage2.len() <= u16::MAX as usize);
        debug_assert!(stage3.len() <= u8::MAX as usize);

        let stage1_owned = stage1.into_boxed_slice();
        let stage2_owned = stage2.into_boxed_slice();
        let stage3_owned = stage3.into_boxed_slice();

        Ok(Tables {
            stage1: stage1_owned,
            stage2: stage2_owned,
            stage3: stage3_owned,
        })
    }
}

/// 3-level lookup table for codepoint -> Elem mapping.
pub struct Tables<Elem> {
    pub stage1: Box<[u16]>,
    pub stage2: Box<[u8]>,
    pub stage3: Box<[Elem]>,
}

impl<Elem: Copy> Tables<Elem> {
    #[inline]
    pub fn get(&self, cp: u32) -> Elem {
        let high = cp >> 8;
        let low: u16 = (cp & 0xFF) as u16;
        self.stage3[self.stage2[(self.stage1[high as usize] + low) as usize] as usize]
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/unicode/uucode/lut.zig (127 lines)
//   confidence: medium
//   todos:      2
//   notes:      build-time only; u21→u32, BlockMap→bun_collections::HashMap (wyhash), Context duck-typing→trait
// ──────────────────────────────────────────────────────────────────────────
