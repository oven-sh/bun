//! A document that arrives in pieces.
//!
//! Every line is analyzed once, when its end has arrived. A block at the top level of the document is rendered, and
//! its text let go, after the line that ends it. What is rendered does not depend on where the pieces are cut. It is
//! what the whole document is rendered as, but that a reference does not see the definitions in later blocks.

use std::collections::VecDeque;

use bun_collections::{HashMap, StringSet};
use bun_core::strings;

use crate::blocks::ReadUntil;
use crate::containers::BlockPlace;
use crate::helpers::{self, HeadingIdTracker};
use crate::html_renderer::HtmlRenderer;
use crate::parser::{BlockHeader, MAX_INPUT_LEN, Parser, ParserError, RefDef, max_ref_def_output};
use crate::root::Options;
use crate::tokens::{TokenBuilder, Tokens};
use crate::types::{
    self, Container, ContainerEnds, Line, OFF, Renderer, RendererImpl, VerbatimLine,
};

pub struct Stream {
    text: Vec<u8>,
    /// The lines before this place in `text` have their ends.
    lines_end: usize,
    /// There is more than white space behind `lines_end`.
    last_line_has_text: bool,
    state: State,
}

struct State {
    options: Options,
    has_carriage_return: bool,
    open: OpenBlocks,
    ref_defs: Vec<RefDef>,
    ref_def_labels: StringSet,
    /// The length of the labels, destinations and titles.
    ref_def_bytes: usize,
    ref_def_budget: RefDefBudget,
    heading_ids: HeadingIdTracker,
    kept: Kept,
}

/// The list items and the rows of tables in the open blocks that the renderer has been told to keep.
#[derive(Default)]
struct Kept {
    /// By the index of the opener in `blocks`.
    items: HashMap<usize, KeptItem>,
    /// By the index in `block_lines`.
    rows: HashMap<usize, u32>,
    n_slots: u32,
}

#[derive(Clone, Copy)]
struct KeptItem {
    slot: u32,
    is_loose: bool,
    behind: BlockPlace,
}

pub(crate) struct Reuse {
    kept: Kept,
    pub(crate) is_on: bool,
    /// No text that is still to come changes the first so many of `blocks` and of `block_lines`.
    n_settled_blocks: usize,
    n_settled_lines: usize,
    has_heading_ids: bool,
    pub(crate) n_headings: usize,
    open_items: Vec<OpenItem>,
    /// `Parser::max_ref_def_output` before the row that is rendered.
    budget_before_row: u64,
}

struct OpenItem {
    opener: usize,
    is_loose: bool,
    n_headings: usize,
    budget: u64,
}

/// `Parser::max_ref_def_output` grows with the document.
#[derive(Clone, Copy, Default)]
struct RefDefBudget {
    /// How much of the document is before the text.
    released_len: u64,
    granted: u64,
    left: u64,
}

/// What `Parser` knows between two lines about the blocks that it has not rendered.
#[derive(Clone, Default)]
struct OpenBlocks {
    /// They are written from this place in the text on.
    beg: OFF,
    /// The next line.
    off: OFF,
    is_past_first_line: bool,
    /// The first so many of `blocks` are a block that has ended. It waits for the end of the empty lines behind it.
    n_held: usize,
    pivot_line: Line,
    containers: Vec<Container>,
    directives: Vec<u32>,
    quotes: Vec<u32>,
    container_ends: VecDeque<ContainerEnds>,
    container_sources: Vec<(OFF, OFF, u32)>,
    blocks: Vec<BlockHeader>,
    block_lines: Vec<VerbatimLine>,
    current_block: Option<BlockHeader>,
    current_block_first_line: usize,
    html_block_type: u8,
    fence_indent: u32,
    last_line_has_list_loosening_effect: bool,
    last_list_item_starts_with_two_blank_lines: bool,
    last_header_opens_list_item: bool,
    last_line_is_only_a_task_mark: bool,
}

impl OpenBlocks {
    /// The text before `beg` is gone.
    fn move_to_start(&mut self) {
        let by = core::mem::take(&mut self.beg);
        self.off -= by;
        for line in &mut self.block_lines {
            line.beg -= by;
            line.end -= by;
        }
        for block in self.blocks.iter_mut().chain(&mut self.current_block) {
            if block.flags & types::BLOCK_FENCED_CODE != 0 {
                block.data -= by;
            }
        }
        for said in &mut self.container_ends {
            said.end = said.end.saturating_sub(by);
        }
        for (beg, end, _) in &mut self.container_sources {
            *beg -= by;
            *end = end.saturating_sub(by);
        }
        for container in &mut self.containers {
            container.mark_beg -= by;
            container.mark_end -= by;
            if container.is_task {
                container.task_mark_off -= by;
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Part {
    /// The blocks that no more text can change. They are rendered once.
    Finished,
    /// What `Rest` would be, without a character of which some bytes are missing. The stream stays as it is.
    Preview,
    /// Everything that is left: the document ends here.
    Rest,
}

impl Stream {
    pub fn new(options: Options) -> Stream {
        // A reference to a footnote comes before the definition.
        debug_assert!(!options.footnotes);
        Stream {
            text: Vec::new(),
            lines_end: 0,
            last_line_has_text: false,
            state: State {
                options,
                has_carriage_return: false,
                open: OpenBlocks::default(),
                ref_defs: Vec::new(),
                ref_def_labels: StringSet::new(),
                ref_def_bytes: 0,
                ref_def_budget: RefDefBudget::default(),
                heading_ids: HeadingIdTracker::init(options.heading_ids),
                kept: Kept::default(),
            },
        }
    }

    pub fn push(&mut self, piece: &[u8]) -> Result<(), ParserError> {
        let from = self.text.len();
        if piece.len() > MAX_INPUT_LEN - from {
            return Err(ParserError::InputTooLarge);
        }
        self.text
            .try_reserve(piece.len())
            .map_err(|_| ParserError::OutOfMemory)?;
        self.text.extend_from_slice(piece);

        self.state.has_carriage_return |= strings::contains_char(&self.text[from..], b'\r');
        // A `\r` at the end can be the start of a `\r\n`.
        let from = from.saturating_sub(1);
        let unseen = &self.text[from..];
        let unseen = unseen.strip_suffix(b"\r").unwrap_or(unseen);
        if let Some(line_end) = strings::last_index_of_any(unseen, b"\r\n") {
            self.lines_end = from + line_end + 1;
            self.last_line_has_text = false;
        }
        let unseen = &self.text[from.max(self.lines_end)..];
        self.last_line_has_text =
            self.last_line_has_text || unseen.iter().any(|c| !matches!(c, b' ' | b'\t' | b'\r'));
        Ok(())
    }

    /// After a pass over [`Part::Finished`].
    pub fn release_rendered_text(&mut self) {
        let open = &mut self.state.open;
        let rendered = open.beg as usize;
        if rendered == 0 {
            return;
        }
        self.text.drain(..rendered);
        self.lines_end -= rendered;
        self.state.ref_def_budget.released_len += rendered as u64;
        open.move_to_start();

        shrink(&mut self.text);
        shrink(&mut open.blocks);
        shrink(&mut open.block_lines);
        shrink(&mut open.containers);
        shrink(&mut open.container_sources);
    }

    /// How many bytes of the document are kept.
    pub fn text_len(&self) -> usize {
        self.text.len()
    }

    /// `None` if there is nothing to look at.
    pub fn pass(&mut self, part: Part) -> Option<Pass<'_>> {
        let (beg, end) = match part {
            Part::Finished => (self.state.open.off, self.lines_end),
            Part::Preview => (self.state.open.beg, whole_characters_end(&self.text)),
            Part::Rest => (self.state.open.beg, self.text.len()),
        };
        let releases_held =
            part == Part::Finished && self.state.open.n_held > 0 && self.last_line_has_text;
        ((beg as usize) < end || releases_held).then(|| Pass {
            text: &self.text[..end],
            text_follows: self.last_line_has_text,
            beg: beg as usize,
            state: &mut self.state,
            part,
        })
    }

    /// Whether a later pass can ask the renderer for what it has kept.
    pub fn has_kept(&self) -> bool {
        self.state.kept.n_slots > 0
    }

    pub fn forget_kept(&mut self) {
        self.state.kept = Kept::default();
    }

    pub fn memory_cost(&self) -> usize {
        let open = &self.state.open;
        self.text.capacity()
            + self.state.ref_defs.capacity() * (size_of::<RefDef>() + size_of::<Box<[u8]>>())
            + self.state.ref_def_bytes
            + self.state.heading_ids.slug_bytes
            + open.blocks.capacity() * size_of::<BlockHeader>()
            + open.block_lines.capacity() * size_of::<VerbatimLine>()
            + open.containers.capacity() * size_of::<Container>()
            + open.container_sources.capacity() * size_of::<(OFF, OFF, u32)>()
            + self.state.kept.n_slots as usize * size_of::<(usize, KeptItem)>()
    }
}

fn shrink<T>(vec: &mut Vec<T>) {
    const KEPT_BYTES: usize = 128 * 1024;
    if vec.capacity() / 4 > vec.len() && vec.capacity() * size_of::<T>() > KEPT_BYTES {
        vec.shrink_to(vec.len() * 2);
    }
}

fn whole_characters_end(text: &[u8]) -> usize {
    let last_three = text.len().saturating_sub(3);
    let lead = (last_three..text.len())
        .rev()
        .find(|&i| strings::is_utf8_char_boundary(text[i]));
    match lead {
        Some(i) if i + usize::from(strings::utf8_byte_sequence_length(text[i])) > text.len() => i,
        _ => text.len(),
    }
}

/// One rendering of a [`Part`]. If it fails, and is no preview, the stream is of no more use.
pub struct Pass<'a> {
    text: &'a [u8],
    text_follows: bool,
    beg: usize,
    state: &'a mut State,
    part: Part,
}

impl<'a> Pass<'a> {
    /// What the places that the renderer is told are in.
    pub fn text(&self) -> &'a [u8] {
        self.text
    }

    pub(crate) fn part(&self) -> Part {
        self.part
    }

    /// How much of the text no pass has looked at, or rendered.
    pub(crate) fn new_text_len(&self) -> usize {
        self.text.len() - self.beg
    }

    /// Whether the renderer can be told to keep or to reuse something.
    pub fn uses_slots(&self) -> bool {
        self.part == Part::Preview || self.state.kept.n_slots > 0
    }

    pub fn render_to_tokens(self) -> Result<Tokens, ParserError> {
        let mut builder = TokenBuilder::new(self.text, self.state.open.beg, self.state.options);
        self.render(&mut builder)?;
        builder.finish()
    }

    pub fn render_to_html(self) -> Result<Box<[u8]>, ParserError> {
        let mut renderer = HtmlRenderer::init(self.text, self.state.options.to_render_options());
        self.render(&mut renderer)?;
        Ok(renderer.to_owned_slice()?)
    }

    /// `renderer` is told about the part as about a document.
    pub fn render(self, renderer: &mut dyn RendererImpl) -> Result<(), ParserError> {
        let Pass {
            text,
            text_follows,
            state,
            part,
            ..
        } = self;
        debug_assert!(!renderer.wants_source() || renderer.wants_inline_content());
        let is_preview = part == Part::Preview;
        let uses_slots = is_preview || state.kept.n_slots > 0;
        let reuse = (uses_slots && renderer.can_keep()).then(|| Reuse {
            kept: core::mem::take(&mut state.kept),
            is_on: true,
            n_settled_blocks: if is_preview {
                state.open.blocks.len()
            } else {
                0
            },
            n_settled_lines: if is_preview {
                state.open.block_lines.len()
            } else {
                0
            },
            has_heading_ids: state.options.heading_ids,
            n_headings: 0,
            open_items: Vec::new(),
            budget_before_row: 0,
        });

        let n_ref_defs = state.ref_defs.len();
        let mut budget = state.ref_def_budget;
        let open = match part {
            Part::Preview => {
                state.heading_ids.begin_provisional();
                state.open.clone()
            }
            Part::Finished | Part::Rest => core::mem::take(&mut state.open),
        };
        if let Some(heading_ids) = renderer.heading_ids() {
            core::mem::swap(heading_ids, &mut state.heading_ids);
        }

        let mut parser = Parser::new(
            text,
            text.len() as OFF,
            state.has_carriage_return,
            state.options.to_flags(),
            Renderer { ptr: renderer },
        );
        parser.ref_defs = core::mem::take(&mut state.ref_defs);
        parser.ref_def_labels = core::mem::take(&mut state.ref_def_labels);
        parser.reuse = reuse.map(Box::new);
        let result = parser.process_part(open, part, text_follows, &mut budget);
        if let Some(reuse) = parser.reuse.take()
            && (is_preview || reuse.is_on)
        {
            state.kept = reuse.kept;
        }
        state.ref_defs = core::mem::take(&mut parser.ref_defs);
        state.ref_def_labels = core::mem::take(&mut parser.ref_def_labels);
        drop(parser);

        if let Some(heading_ids) = renderer.heading_ids() {
            core::mem::swap(heading_ids, &mut state.heading_ids);
        }
        if part == Part::Preview {
            state.heading_ids.discard_provisional();
            while state.ref_defs.len() > n_ref_defs {
                state.ref_defs.pop();
                state.ref_def_labels.map.pop();
            }
            return result.map(drop);
        }
        state.ref_def_budget = budget;
        let labels = &state.ref_def_labels.keys()[n_ref_defs..];
        for (def, label) in state.ref_defs[n_ref_defs..].iter().zip(labels) {
            state.ref_def_bytes += label.len() + def.dest.len() + def.title.len();
        }
        state.open = result?;
        Ok(())
    }
}

impl Parser<'_> {
    /// Goes on where `open` has stopped. Returns where the text ends.
    fn process_part(
        &mut self,
        open: OpenBlocks,
        part: Part,
        text_follows: bool,
        budget: &mut RefDefBudget,
    ) -> Result<OpenBlocks, ParserError> {
        let (mut beg, mut off, mut n_held, mut pivot_line);
        let is_past_first_line;
        OpenBlocks {
            beg,
            off,
            is_past_first_line,
            n_held,
            pivot_line,
            containers: self.containers,
            directives: self.directives,
            quotes: self.quotes,
            container_ends: self.container_ends,
            container_sources: self.container_sources,
            blocks: self.blocks,
            block_lines: self.block_lines,
            current_block: self.current_block,
            current_block_first_line: self.current_block_first_line,
            html_block_type: self.html_block_type,
            fence_indent: self.fence_indent,
            last_line_has_list_loosening_effect: self.last_line_has_list_loosening_effect,
            last_list_item_starts_with_two_blank_lines: self
                .last_list_item_starts_with_two_blank_lines,
            last_header_opens_list_item: self.last_header_opens_list_item,
            last_line_is_only_a_task_mark: self.last_line_is_only_a_task_mark,
        } = open;
        self.n_containers = self.containers.len() as u32;
        if !is_past_first_line {
            off = self.first_line_beg();
        }

        self.enter_block(types::BlockType::Doc, 0, 0)?;
        self.max_ref_def_output = budget.left;
        while off < self.size {
            self.read_lines(&mut off, &mut pivot_line, ReadUntil::News { n_held })?;
            if n_held > 0 && (self.blocks.len() > n_held || self.has_open_block()) {
                self.render_first_blocks(core::mem::take(&mut n_held))?;
                beg = self.line_beg;
            }
            let n_finished = self.n_finished_blocks();
            if n_finished > n_held {
                self.grant_ref_def_output(off, budget);
                if self.tracks_content && !self.has_open_block() {
                    n_held = self.n_blocks_of_last();
                }
                if n_finished > n_held {
                    self.render_first_blocks(n_finished - n_held)?;
                    beg = self.start_of_first_block();
                }
            }
            if !self.tracks_content && !self.has_open_block() {
                beg = off;
            }
        }
        if n_held > 0 && (part != Part::Finished || text_follows) {
            self.render_first_blocks(core::mem::take(&mut n_held))?;
            beg = off;
        }
        if part != Part::Finished {
            self.close_blocks()?;
            self.grant_ref_def_output(off, budget);
            self.render_first_blocks(self.blocks.len())?;
            beg = off;
        }
        budget.left = self.max_ref_def_output;
        self.renderer.ptr.source_end(beg);
        self.leave_block(types::BlockType::Doc, 0)?;

        self.containers.truncate(self.n_containers as usize);
        Ok(OpenBlocks {
            beg,
            off,
            is_past_first_line: true,
            n_held,
            pivot_line,
            containers: core::mem::take(&mut self.containers),
            directives: core::mem::take(&mut self.directives),
            quotes: core::mem::take(&mut self.quotes),
            container_ends: core::mem::take(&mut self.container_ends),
            container_sources: core::mem::take(&mut self.container_sources),
            blocks: core::mem::take(&mut self.blocks),
            block_lines: core::mem::take(&mut self.block_lines),
            current_block: self.current_block,
            current_block_first_line: self.current_block_first_line,
            html_block_type: self.html_block_type,
            fence_indent: self.fence_indent,
            last_line_has_list_loosening_effect: self.last_line_has_list_loosening_effect,
            last_list_item_starts_with_two_blank_lines: self
                .last_list_item_starts_with_two_blank_lines,
            last_header_opens_list_item: self.last_header_opens_list_item,
            last_line_is_only_a_task_mark: self.last_line_is_only_a_task_mark,
        })
    }

    /// `off` is the next line.
    fn grant_ref_def_output(&mut self, off: OFF, budget: &mut RefDefBudget) {
        let granted = max_ref_def_output(budget.released_len + u64::from(off));
        self.max_ref_def_output += granted - budget.granted;
        budget.granted = granted;
    }

    /// How many of `blocks` the last block at the top level is made of.
    fn n_blocks_of_last(&self) -> usize {
        let mut depth: usize = 0;
        let is_first = |block: &BlockHeader| {
            if block.flags & types::BLOCK_CONTAINER_CLOSER != 0 {
                depth += 1;
            } else if block.flags & types::BLOCK_CONTAINER_OPENER != 0 {
                depth -= 1;
            }
            depth == 0
        };
        let behind_first = self.blocks.iter().rev().position(is_first);
        behind_first.map_or(self.blocks.len(), |it| it + 1)
    }

    /// Of the block that the last line has started.
    fn start_of_first_block(&self) -> OFF {
        match self.block_lines.first() {
            // The header of a table that interrupts a paragraph is on the line before.
            Some(header) if header.beg < self.line_beg => {
                helpers::trim_blank_end(&self.text[..header.beg as usize]).len() as OFF
            }
            _ => self.line_beg,
        }
    }

    fn render_first_blocks(&mut self, n_blocks: usize) -> Result<(), ParserError> {
        if n_blocks == 0 {
            return Ok(());
        }
        let finished = &self.blocks[..n_blocks];
        let n_lines = finished.iter().map(|it| it.n_lines as usize).sum();
        self.render_blocks(n_blocks, n_lines)?;

        for container in &mut self.containers[..self.n_containers as usize] {
            container.opener_index -= n_blocks as u32;
        }
        self.current_block_first_line = self.current_block_first_line.saturating_sub(n_lines);
        // The indices have changed.
        if let Some(reuse) = &mut self.reuse {
            reuse.is_on = false;
        }
        Ok(())
    }

    /// Returns what is behind the list item that starts at `opener`, if it need not be rendered.
    pub(crate) fn reuse_item(
        &mut self,
        opener: BlockPlace,
        is_loose: bool,
    ) -> Result<Option<BlockPlace>, ParserError> {
        let Some(reuse) = self.reuse.as_mut().filter(|it| it.is_on) else {
            return Ok(None);
        };
        if let Some(&item) = reuse.kept.items.get(&opener.block)
            && item.is_loose == is_loose
        {
            self.renderer.ptr.reuse(item.slot)?;
            return Ok(Some(item.behind));
        }
        reuse.open_items.push(OpenItem {
            opener: opener.block,
            is_loose,
            n_headings: reuse.n_headings,
            budget: self.max_ref_def_output,
        });
        Ok(None)
    }

    pub(crate) fn keep_item(&mut self, behind: BlockPlace) -> Result<(), ParserError> {
        let Some(reuse) = &mut self.reuse else {
            return Ok(());
        };
        let Some(item) = reuse.open_items.pop() else {
            return Ok(());
        };
        if behind.block > reuse.n_settled_blocks
            || (reuse.has_heading_ids && item.n_headings != reuse.n_headings)
            || !is_unspent(item.budget, self.max_ref_def_output)
        {
            return Ok(());
        }
        let slot = reuse.kept.next_slot();
        let kept = KeptItem {
            slot,
            is_loose: item.is_loose,
            behind,
        };
        reuse.kept.items.put(item.opener, kept)?;
        self.renderer.ptr.keep(slot)
    }

    pub(crate) fn reuse_row(&mut self, line: usize) -> Result<bool, ParserError> {
        let Some(reuse) = self.reuse.as_mut().filter(|it| it.is_on) else {
            return Ok(false);
        };
        let Some(&slot) = reuse.kept.rows.get(&line) else {
            reuse.budget_before_row = self.max_ref_def_output;
            return Ok(false);
        };
        self.renderer.ptr.reuse(slot)?;
        Ok(true)
    }

    pub(crate) fn keep_row(&mut self, line: usize) -> Result<(), ParserError> {
        let Some(reuse) = self.reuse.as_mut().filter(|it| it.is_on) else {
            return Ok(());
        };
        if line >= reuse.n_settled_lines
            || !is_unspent(reuse.budget_before_row, self.max_ref_def_output)
        {
            return Ok(());
        }
        let slot = reuse.kept.next_slot();
        reuse.kept.rows.put(line, slot)?;
        self.renderer.ptr.keep(slot)
    }
}

impl Kept {
    fn next_slot(&mut self) -> u32 {
        self.n_slots += 1;
        self.n_slots - 1
    }
}

/// No reference has been charged for, or has been left as text because nothing was left.
fn is_unspent(budget_before: u64, budget: u64) -> bool {
    budget_before == budget && budget > 0
}
