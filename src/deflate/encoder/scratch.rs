//! Memory in which nothing is kept, so that the streams of a thread share it.

use bun_highway::deflate::{Codes, Dynamic, MAX_SAFE_STAMP, SCRATCH_LEN};
use core::cell::Cell;
use core::mem::swap;

use super::codes::FIXED;
use super::parser::SHORT_LEN;
use super::{Block, Effort, Method, Parser, Window};
use crate::Result;

/// More would take tables that are twice as long.
const MAX_INPUT: usize = 6656;

pub struct Scratch {
    /// Only has a capacity.
    pub(super) parsing: Vec<u8>,
    pub(super) dynamic: Dynamic,
    pub(super) codes: Codes,
    for_one_batch: (Window, Parser, Block),
}

std::thread_local! {
    static SPARE: Cell<Option<Box<Scratch>>> = const { Cell::new(None) };
}

impl Scratch {
    #[cold]
    fn new() -> Result<Box<Self>> {
        let mut parsing = Vec::new();
        parsing.try_reserve_exact(SCRATCH_LEN)?;
        let scratch = Box::try_new(Self {
            parsing,
            dynamic: Dynamic::UNMADE,
            codes: FIXED,
            for_one_batch: Default::default(),
        });
        let mut scratch = scratch.map_err(|_| bun_alloc::AllocError)?;
        let (window, parser, block) = &mut scratch.for_one_batch;
        let (effort, min_len) = (Effort::High, 3);
        *window = Window::new(15);
        window.try_reserve(MAX_INPUT)?;
        parser.try_reserve(Method::Matches { effort, min_len }, window)?;
        block.try_reserve(0, MAX_INPUT)?;
        Ok(scratch)
    }

    pub fn lend<R>(borrow: impl FnOnce(&mut Self) -> R) -> Result<R> {
        let spare = SPARE.try_with(Cell::take).ok().flatten();
        let mut scratch = spare.map_or_else(Self::new, Ok)?;
        let result = borrow(&mut scratch);
        _ = SPARE.try_with(|spare| spare.set(Some(scratch)));
        Ok(result)
    }

    pub(crate) fn free_spare() {
        _ = SPARE.try_with(Cell::take);
    }

    /// For a whole stream, which is parsed at once.
    pub fn has_memory_for(method: Method, len: usize) -> bool {
        len <= match method {
            Method::Matches { effort, .. } if effort < Effort::Lower => SHORT_LEN as usize,
            Method::Matches { effort, .. } if effort > Effort::Highest => 0,
            _ => MAX_INPUT,
        }
    }

    /// All three are clear.
    pub fn lend_memory(&mut self, window: &mut Window, parser: &mut Parser, block: &mut Block) {
        let spare = &mut self.for_one_batch;
        swap(&mut spare.0.bytes, &mut window.bytes);
        swap(&mut spare.0.stamp, &mut window.stamp);
        swap(&mut spare.1, parser);
        swap(&mut spare.2, block);
    }

    /// The next stream starts too far behind this one to see what is in the tables.
    pub fn take_memory(&mut self, window: &mut Window, parser: &mut Parser, block: &mut Block) {
        let stamp = window.stamp + window.end;
        window.clear();
        block.clear();
        if stamp + Window::START + (MAX_INPUT as u32) < MAX_SAFE_STAMP {
            window.stamp = stamp;
            parser.clear_all_but_entries();
        } else {
            parser.clear();
        }
        self.lend_memory(window, parser, block);
    }
}
