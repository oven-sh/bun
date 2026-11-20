//! Compresses input that is at hand into a frame, or a part of one.

use core::sync::atomic::{AtomicBool, Ordering};

use bun_zstd_decoder::format::{
    BLOCK_HEADER_LEN, BLOCK_LEN_MAX, BlockType, FRAME_HEADER_LEN_MAX, FRAME_MAGIC, WINDOW_LOG_MIN,
};
use bun_zstd_decoder::{Error, Output, Result, XxHash64};

use crate::block::{self, BlockWriter, Content, append};
use crate::dictionary::Dictionary;
use crate::entropy::looks_random;
use crate::matches::long_distance::{self, Candidates};
use crate::matches::{MatchState, Owner, Search};
use crate::parameters::{LongMatches, Plan, Purpose};
use crate::sequences::{Repeats, Sequences};
use crate::vec::{self, Shared};
use crate::window::{Input, WORD_LEN};
use crate::{post_split, pre_split, sub_blocks};

pub(crate) fn last_empty_block() -> [u8; BLOCK_HEADER_LEN] {
    block::header(BlockType::Raw, 0, true)
}

pub(crate) fn checksum(hash: &XxHash64) -> [u8; 4] {
    (hash.digest() as u32).to_le_bytes()
}

/// Whether another thread still waits for the output.
#[derive(Clone, Default)]
pub(crate) struct Interest {
    is_lost: Option<Shared<AtomicBool>>,
}

impl Interest {
    pub(crate) fn new() -> Result<Self> {
        let is_lost = Some(vec::shared(AtomicBool::new(false))?);
        Ok(Self { is_lost })
    }

    pub(crate) fn lose(&self) {
        if let Some(is_lost) = &self.is_lost {
            is_lost.store(true, Ordering::SeqCst);
        }
    }

    pub(crate) fn ensure(&self) -> Result<()> {
        match &self.is_lost {
            Some(is_lost) if is_lost.load(Ordering::SeqCst) => Err(Error::StageWrong),
            _ => Ok(()),
        }
    }
}

/// What precedes the input.
#[derive(Clone, Copy)]
pub(crate) enum Start<'a> {
    Frame(Option<&'a Dictionary>),
    /// The end of the input of an earlier part of the frame, which the first [`Input`] follows.
    Part(&'a [u8]),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    BeforeHeader,
    InBlocks,
    AfterLastBlock,
}

pub(crate) struct FrameWriter {
    plan: Plan,
    input_len: Option<u64>,
    dictionary_id: u32,
    is_dictionary_attached: bool,
    block_len_max: usize,
    stage: Stage,
    consumed: u64,
    produced: u64,
    hash: XxHash64,
    state: MatchState,
    sequences: Sequences,
    blocks: BlockWriter,
    long_finder: Option<long_distance::Finder>,
    /// Without a finder, they can come from elsewhere.
    pub(crate) long_matches: Candidates,
    pub(crate) interest: Interest,
}

impl FrameWriter {
    /// Has to be [`start`](Self::start)ed.
    pub(crate) fn new(plan: Plan) -> Self {
        Self {
            plan,
            input_len: None,
            dictionary_id: 0,
            is_dictionary_attached: false,
            block_len_max: 0,
            stage: Stage::BeforeHeader,
            consumed: 0,
            produced: 0,
            hash: XxHash64::new(),
            state: MatchState::new(plan.tuning),
            sequences: Sequences::new(),
            blocks: BlockWriter::new(),
            long_finder: None,
            long_matches: Candidates::default(),
            interest: Interest::default(),
        }
    }

    pub(crate) fn start(
        &mut self,
        mut plan: Plan,
        input_len: Option<u64>,
        start: Start<'_>,
    ) -> Result<()> {
        let dictionary = match start {
            Start::Frame(dictionary) => dictionary,
            Start::Part(_) => None,
        };
        let is_attached = dictionary.is_some_and(|it| it.is_attached_for(input_len));
        if let Some(Dictionary { state, .. }) = dictionary {
            let window_log = plan.tuning.window_log;
            plan.tuning = state.tuning;
            if is_attached {
                let purpose = Purpose::Frame { dictionary_len: 0 };
                plan.tuning = plan.tuning.fitted(input_len, purpose);
            }
            plan.tuning.window_log = window_log;
            plan.uses_rows = state.uses_rows;
        }
        let tuning = plan.tuning;

        (self.plan, self.input_len) = (plan, input_len);
        self.block_len_max = self.window_len().min(BLOCK_LEN_MAX);
        (self.consumed, self.produced) = (0, 0);
        self.hash = XxHash64::new();
        self.stage = Stage::BeforeHeader;
        self.dictionary_id = dictionary.map_or(0, |it| it.id);
        self.is_dictionary_attached = false;
        let loaded_len = match start {
            Start::Frame(_) => 0,
            Start::Part(earlier) => earlier.len(),
        };
        self.state
            .reset(tuning, plan.uses_rows, Owner::Frame, loaded_len)?;
        self.blocks.is_at_start = true;
        self.long_finder = None;
        self.long_matches.clear();
        if let LongMatches::Own(parameters) = plan.long_matches {
            let parameters = parameters.completed(&tuning);
            self.long_finder = Some(long_distance::Finder::new(parameters, tuning.window_log)?);
            self.long_matches
                .clear_for(self.block_len_max, &parameters)?;
        }

        match start {
            Start::Frame(None) => {
                self.blocks.entropy.forget();
                self.blocks.repeats = Repeats::INITIAL;
                if let LongMatches::None = plan.long_matches {
                    self.state.start_at_0(input_len);
                }
            }
            Start::Frame(Some(dictionary)) => {
                self.blocks.entropy.copy_from(&dictionary.entropy)?;
                self.blocks.repeats = dictionary.repeats;
                if !is_attached {
                    self.state.copy_from(&dictionary.state);
                } else if !dictionary.content().is_empty() {
                    self.state.attach(&dictionary.state);
                    self.is_dictionary_attached = true;
                }
            }
            Start::Part(earlier) => {
                self.blocks.entropy.forget();
                self.blocks.repeats = Repeats::default();
                self.stage = Stage::InBlocks;
                if earlier.len() >= WORD_LEN {
                    let is_lost = || self.interest.ensure().is_err();
                    self.state.load::<{ Owner::Frame }>(earlier, is_lost);
                }
            }
        }
        Ok(())
    }

    pub(crate) fn window_len(&self) -> usize {
        let len = 1u64 << self.plan.tuning.window_log;
        len.min(self.input_len.unwrap_or(u64::MAX)).max(1) as usize
    }

    /// See [`MatchState::tables_len`].
    pub(crate) fn tables_len(&self) -> [usize; 2] {
        self.state.tables_len()
    }

    pub(crate) fn block_len_max(&self) -> usize {
        self.block_len_max
    }

    fn write_header(&self, out: &mut Output<'_>) -> Result<()> {
        let (flags, window_log) = (self.plan.header, self.plan.tuning.window_log);
        if out.room() < FRAME_HEADER_LEN_MAX {
            return Err(Error::DstSizeTooSmall);
        }
        let (id_code, id_len) = match self.dictionary_id {
            _ if !flags.has_dictionary_id => (0, 0),
            0 => (0, 0),
            1..0x100 => (1, 1),
            0x100..0x1_0000 => (2, 2),
            _ => (3, 4),
        };
        let size = self.input_len.filter(|_| flags.has_content_size);
        let is_single_segment = size.is_some_and(|size| size <= 1 << window_log);
        let (size_code, size_len, size) = match size {
            None => (0, 0, 0),
            Some(size @ ..0x100) => (0, usize::from(is_single_segment), size),
            Some(size @ ..0x1_0100) => (1, 2, size - 0x100),
            Some(size @ ..0xFFFF_FFFF) => (2, 4, size),
            Some(size) => (3, 8, size),
        };
        let descriptor = id_code
            | u8::from(flags.has_checksum) << 2
            | u8::from(is_single_segment) << 5
            | size_code << 6;
        let window = ((window_log - WINDOW_LOG_MIN) << 3) as u8;

        let fields: [(&[u8], usize); 5] = [
            (&FRAME_MAGIC.to_le_bytes(), 4 * usize::from(flags.has_magic)),
            (&[descriptor], 1),
            (&[window], usize::from(!is_single_segment)),
            (&self.dictionary_id.to_le_bytes(), id_len),
            (&size.to_le_bytes(), size_len),
        ];
        for (bytes, len) in fields {
            append(out, bytes.get(..len).unwrap_or(bytes))?;
        }
        Ok(())
    }

    /// `dictionary` is the one that the frame started with.
    pub(crate) fn write(
        &mut self,
        input: &Input<'_>,
        dictionary: Option<&Dictionary>,
        is_last: bool,
        out: &mut Output<'_>,
    ) -> Result<()> {
        let consumed = self.consumed + input.len as u64;
        if self
            .input_len
            .is_some_and(|len| consumed > len || (is_last && consumed < len))
        {
            return Err(Error::SrcSizeWrong);
        }
        let written_before = out.written();
        if self.stage == Stage::BeforeHeader {
            self.write_header(out)?;
            self.stage = Stage::InBlocks;
        }
        if input.len != 0 {
            self.write_blocks(input, dictionary, is_last, out)?;
            self.consumed = consumed;
            self.produced += (out.written() - written_before) as u64;
        }
        if is_last {
            if self.stage != Stage::AfterLastBlock {
                append(out, &last_empty_block())?;
            }
            if self.plan.header.has_checksum {
                append(out, &checksum(&self.hash))?;
            }
        }
        Ok(())
    }

    fn write_blocks(
        &mut self,
        input: &Input<'_>,
        dictionary: Option<&Dictionary>,
        is_last: bool,
        out: &mut Output<'_>,
    ) -> Result<()> {
        self.state.admit(input);
        if let Some(finder) = &mut self.long_finder {
            finder.admit(input);
        }
        if self.plan.header.has_checksum {
            self.hash.update(input.new_bytes());
        }

        let mut saved = self.consumed as i64 - self.produced as i64;
        let mut start = input.start();
        while let Some(left @ [_, ..]) = input.segment.get(start..) {
            self.interest.ensure()?;
            let len = match left.first_chunk() {
                // More block headers must not make the output larger than it could be without.
                Some(block) if self.block_len_max == BLOCK_LEN_MAX && saved >= 3 => {
                    pre_split::block_len(block, self.plan.tuning.strategy)
                }
                _ => left.len().min(self.block_len_max),
            };
            let written_before = out.written();
            let is_last = is_last && len == left.len();
            self.write_block(input, dictionary, start, len, is_last, out)?;
            saved += len as i64 - (out.written() - written_before) as i64;
            start += len;
            self.blocks.is_at_start = false;
            self.blocks.distrust_offset_table();
        }
        if is_last {
            self.stage = Stage::AfterLastBlock;
        }
        Ok(())
    }

    fn write_block(
        &mut self,
        input: &Input<'_>,
        dictionary: Option<&Dictionary>,
        start: usize,
        len: usize,
        is_last: bool,
        out: &mut Output<'_>,
    ) -> Result<()> {
        const WORTH_TRYING_FROM: usize = 7;
        let bytes = input.segment.get(start..start + len);
        let bytes = bytes.ok_or(Error::Internal)?;
        self.state.prepare_for(len);
        if len < WORTH_TRYING_FROM {
            if let Some(finder) = &mut self.long_finder {
                finder.skip(len);
            }
            self.state.window.next += len as u32;
            return block::write_raw(bytes, is_last, out);
        }

        let (matched_len, repeats) = self.find_sequences(input, dictionary, start, len)?;
        let (blocks, tuning) = (&mut self.blocks, &self.plan.tuning);
        let is_hopeless = if tuning.compresses_literals() {
            matched_len == 0 && looks_random(bytes)
        } else {
            let literal_count = self.sequences.literal_count(bytes);
            literal_count.is_some_and(|count| count >= tuning.strategy.worth_it_below(len))
        };
        if is_hopeless && self.plan.target_block_len == 0 {
            return blocks.write_uncompressed(bytes, is_last, out);
        }
        self.sequences.finish(bytes, matched_len)?;
        let content = Content {
            bytes,
            sequences: &self.sequences.list,
            literals: self.sequences.literals(),
            counts: &self.sequences.counts,
            repeats,
        };
        if self.plan.target_block_len != 0 {
            let target_len = self.plan.target_block_len;
            sub_blocks::write(blocks, &content, tuning, target_len, is_last, out)
        } else if self.plan.splits_blocks {
            let all = &mut self.sequences;
            post_split::write(blocks, bytes, all, repeats, tuning, is_last, out)
        } else {
            blocks.write(&content, tuning, is_last, out)
        }
    }

    /// Returns how far they go, and the recent offsets after them.
    fn find_sequences(
        &mut self,
        input: &Input<'_>,
        dictionary: Option<&Dictionary>,
        start: usize,
        len: usize,
    ) -> Result<(u32, Repeats)> {
        let state = &mut self.state;
        state.skip_indexing(state.window.next, 384);
        let mut search = Search {
            history: state.window.history(input, start, len),
            attached: None,
            entropy: &self.blocks.entropy,
            long_matches: None,
        };
        if let Some(dictionary) = dictionary
            && self.is_dictionary_attached
            && state.dictionary_end != 0
        {
            search.history.older = dictionary.content();
            search.attached = Some(&dictionary.state);
        }

        let (sequences, mut repeats) = (&mut self.sequences, self.blocks.repeats);
        sequences.clear_for(len, state.tuning.min_match)?;
        state.reserve(len)?;
        if let Some(finder) = &mut self.long_finder {
            self.long_matches.clear();
            finder.find(input, start, len, &mut self.long_matches, || false);
        }
        let end = if self.long_finder.is_some() || !self.long_matches.are_used_up() {
            self.long_matches
                .search(state, &search, sequences, &mut repeats)
        } else {
            state.search(&search, sequences, &mut repeats)
        };
        state.window.next += len as u32;
        Ok((end.wrapping_sub(search.history.start), repeats))
    }
}

#[cfg(test)]
mod tests {
    use bun_zstd_decoder::decompress;

    use super::*;
    use crate::parameters::Request;
    use crate::vec;
    use crate::window::{FIRST_INDEX, INDEX_MAX, Window};

    const PIECE_LEN: usize = 3000;

    #[test]
    fn only_another_thread_loses_interest() -> Result<()> {
        let (own, shared) = (Interest::default(), Interest::new()?);
        own.lose();
        shared.lose();
        assert_eq!(shared.ensure(), Err(Error::StageWrong));
        own.ensure()
    }

    /// Words of 3 to 10 bytes.
    fn sample() -> Vec<u8> {
        let words = (0..3000u64).map(|it| {
            let hash = XxHash64::hash(&it.to_le_bytes());
            let word = XxHash64::hash(&(hash % 500).to_le_bytes()).to_le_bytes();
            word.into_iter()
                .chain([b' '; 2])
                .take(3 + (hash >> 20) as usize % 8)
        });
        words.flatten().collect()
    }

    fn request(parameters: &[(u32, i32)]) -> Result<Request> {
        let mut request = Request::new(1);
        for &(key, value) in parameters {
            request.set(key, value)?;
        }
        Ok(request)
    }

    fn writer(request: &Request, next_index: u32) -> FrameWriter {
        let tuning = request.tuning(None, Purpose::Frame { dictionary_len: 0 });
        let mut writer = FrameWriter::new(request.plan(tuning));
        writer.state.window = Window::starting_at(next_index);
        writer
    }

    /// In pieces, of which every other one is somewhere else than the one before.
    fn write(
        writer: &mut FrameWriter,
        bytes: &[u8],
        dictionary: Option<&Dictionary>,
    ) -> Result<Vec<u8>> {
        let mut frame = Vec::with_capacity(2 * bytes.len());
        let mut out = Output::spare_capacity(&mut frame, usize::MAX);
        let mut older = dictionary.map(Dictionary::content).unwrap_or_default();
        for segment in bytes.chunks(2 * PIECE_LEN) {
            let first = segment.get(..PIECE_LEN).unwrap_or(segment);
            writer.write(&Input::alone(first, older), dictionary, false, &mut out)?;
            let second = Input {
                segment,
                len: segment.len() - first.len(),
                follows_last: true,
                older,
            };
            writer.write(&second, dictionary, false, &mut out)?;
            older = segment;
        }
        writer.write(&Input::alone(&[], &[]), dictionary, true, &mut out)?;
        drop(out);
        Ok(frame)
    }

    #[test]
    fn lowering_indices_changes_nothing() -> Result<()> {
        let bytes = sample();
        for strategy in 1..=9 {
            for (window_log, chain_log) in [(10, 6), (10, 12), (12, 9), (15, 10)] {
                let request = request(&[
                    (101, window_log),
                    (102, 10),
                    (103, chain_log),
                    (104, 3),
                    (105, 3 + window_log % 3),
                    (107, strategy),
                ])?;
                let frame_from = |index| {
                    let mut writer = writer(&request, FIRST_INDEX);
                    writer.start(writer.plan, None, Start::Frame(None))?;
                    writer.state.window = Window::starting_at(index);
                    writer.state.next_to_index = index;
                    let frame = write(&mut writer, &bytes, None)?;
                    assert!(writer.state.window.next < 1 << 17);
                    Ok::<_, Error>(frame)
                };
                let expected = frame_from(FIRST_INDEX)?;
                // Among them those from which a block starts at the first indices of a cycle
                let pieces = [1, 2, 3, 4].map(|it| it * PIECE_LEN as u32);
                for before in pieces
                    .into_iter()
                    .flat_map(|it| [it - 2, it - 1, it, it + 700])
                {
                    let frame = frame_from(INDEX_MAX - before)?;
                    assert!(frame == expected, "{strategy} {window_log} {before}");
                }
            }
        }
        Ok(())
    }

    #[test]
    fn indices_start_over_when_a_frame_starts_near_the_end() -> Result<()> {
        let request = request(&[(101, 12), (107, 4)])?;
        let last_kept = INDEX_MAX - (16 << 20);
        for (index, start, expected) in [
            (last_kept, Start::Frame(None), last_kept),
            (last_kept + 1, Start::Frame(None), FIRST_INDEX),
            (last_kept - 8, Start::Part(&[0; 8]), last_kept),
            (last_kept - 8, Start::Part(&[0; 9]), FIRST_INDEX + 9),
        ] {
            let mut writer = writer(&request, index);
            writer.start(writer.plan, None, start)?;
            assert_eq!(writer.state.window.next, expected);
        }

        // What the tables hold is not taken for input of the new frame.
        let bytes = sample();
        let mut writer = writer(&request, FIRST_INDEX);
        writer.start(writer.plan, None, Start::Frame(None))?;
        let expected = write(&mut writer, &bytes, None)?;
        writer.state.window.next = INDEX_MAX;
        writer.start(writer.plan, None, Start::Frame(None))?;
        assert!(write(&mut writer, &bytes, None)? == expected);
        Ok(())
    }

    #[test]
    fn a_dictionary_is_out_of_reach_once_indices_are_lowered() -> Result<()> {
        let bytes = sample();
        let request = request(&[(101, 17), (107, 2)])?;
        let dictionary = Dictionary::new(&vec::shared(bytes.clone())?, &request)?;
        let frame_from = |index| {
            let mut writer = writer(&request, FIRST_INDEX);
            writer.start(writer.plan, None, Start::Frame(Some(&dictionary)))?;
            writer.state.window = Window::starting_at(index);
            writer.state.attach(&dictionary.state);
            write(
                &mut writer,
                bytes.get(..PIECE_LEN).unwrap_or_default(),
                Some(&dictionary),
            )
        };
        assert!(frame_from(INDEX_MAX - PIECE_LEN as u32)?.len() < 30);

        let frame = frame_from(INDEX_MAX - PIECE_LEN as u32 + 1)?;
        let mut back = [0; PIECE_LEN];
        decompress(&frame, &mut Output::slice(&mut back), None)?;
        assert!(bytes.starts_with(&back));
        Ok(())
    }
}
