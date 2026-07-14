// Sub-modules

use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_collections::bit_set::{ArrayBitSet, num_masks_for};

// Stable Rust cannot branch a type on a const
// generic, so per bit_set.rs guidance we pick `ArrayBitSet` directly. The
// inline scanner in inlines.rs depends on `is_set()` being real — a no-op
// stub here makes every byte fall through the fast path and disables all
// inline-span recognition (emphasis, links, code, entities, breaks).
pub type MarkCharMap = ArrayBitSet<256, { num_masks_for(256) }>;
use bun_core::StackCheck;

use super::helpers;
use super::html_renderer::HtmlRenderer;
use super::types::{
    Align, BlockType, Container, Flags, Mark, NUM_OPENER_STACKS, OFF, OpenerStack, Renderer,
    TABLE_MAXCOLCOUNT, VerbatimLine,
};
use crate::RenderOptions;

// Rust has no struct-scoped type
// aliases, so these live at module scope as `parser::EmphDelim` etc.
pub use super::inlines::{EmphDelim, HtmlScanMemo, MAX_EMPH_MATCHES};
pub use super::ref_defs::RefDef;

/// Parser context holding all state during parsing.
// `text` is a caller-owned borrow for the parser's lifetime.
// PORTING.md's mechanical-port guidance was "no struct lifetimes", but raw-ptr
// here would obscure every `ch()` call; one obvious `'a` is the honest mapping.
pub struct Parser<'a> {
    pub text: &'a [u8],
    pub size: OFF,
    pub flags: Flags,

    // Output
    pub renderer: Renderer<'a>,
    pub image_nesting_level: u32,
    pub link_nesting_level: u32,

    // Code indent offset: 4 normally, maxInt if no_indented_code_blocks
    pub code_indent_offset: u32,
    pub doc_ends_with_newline: bool,

    // Mark character map — bitset of characters that need special handling
    pub mark_char_map: MarkCharMap,

    // Dynamic arrays
    pub marks: Vec<Mark>,
    pub containers: Vec<Container>,
    // 4-byte alignment is
    // load-bearing for the `BlockHeader` reinterpretation in
    // `get_block_header_at`. Here the invariant rests on (a) offsets being
    // padded to a multiple of 4 by every writer and (b) the global allocator
    // returning >=16-byte-aligned bases; `get_block_header_at`
    // debug-asserts it on every access.
    pub block_bytes: Vec<u8>,
    pub buffer: Vec<u8>,
    pub emph_delims: Vec<EmphDelim>,
    // Scratch storage recycled by compute_bracket_matches (links.rs) so inline
    // processing does not allocate a bracket-pair map per block.
    pub bracket_pairs: Vec<(OFF, OFF)>,
    // Label-frame stack recycled by process_inline_content (inlines.rs) so
    // blocks with links do not allocate a frame stack per block.
    pub label_frames: Vec<crate::inlines::LabelFrame>,
    // Memo of failed closing-delimiter searches in find_html_tag (inlines.rs).
    // Cell because find_html_tag is a &self query reached from both &self and
    // &mut self scanners.
    pub html_scan_memo: Cell<HtmlScanMemo>,

    // Number of active containers
    pub n_containers: u32,

    // Current block being built
    pub current_block: Option<usize>,
    pub current_block_lines: Vec<VerbatimLine>,

    // Opener stacks
    pub opener_stacks: [OpenerStack; NUM_OPENER_STACKS],

    // Linked lists through marks
    pub unresolved_link_head: i32,
    pub unresolved_link_tail: i32,
    pub table_cell_boundaries_head: i32,
    pub table_cell_boundaries_tail: i32,

    // HTML block tracking
    pub html_block_type: u8,
    // Fenced code block indent
    pub fence_indent: u32,

    // Table column alignments
    pub table_col_count: u32,
    pub table_alignments: [Align; TABLE_MAXCOLCOUNT as usize],

    // Ref defs
    pub ref_defs: Vec<RefDef>,
    pub ref_def_labels: bun_collections::StringSet,

    // State
    pub last_line_has_list_loosening_effect: bool,
    pub last_list_item_starts_with_two_blank_lines: bool,
    pub max_ref_def_output: u64,

    // Stack overflow protection for recursive inline processing
    pub stack_check: StackCheck,
}

#[repr(C)]
pub struct BlockHeader {
    pub block_type: BlockType,
    pub _pad: [u8; 3],
    pub flags: u32,
    pub data: u32,
    pub n_lines: u32,
}

impl Default for BlockHeader {
    fn default() -> Self {
        Self {
            block_type: BlockType::Doc,
            _pad: [0, 0, 0],
            flags: 0,
            data: 0,
            n_lines: 0,
        }
    }
}

/// `Parser`'s error type: the union of `{ OutOfMemory, JSError, JSTerminated }`
/// with the parser-specific `{ StackOverflow, InputTooLarge, TooManyBlocks }`.
// (`bun_jsc::JsError` covers the first three, but the md crate sits below
// `bun_jsc` in the layering, so the variants stay flat here.)
pub type Error = ParserError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ParserError {
    OutOfMemory,
    JSError,
    JSTerminated,
    StackOverflow,
    /// The input is longer than [`MAX_INPUT_LEN`], so the parser's `u32`
    /// offset arithmetic cannot address it.
    InputTooLarge,
    /// The document needs more than [`MAX_BLOCK_BYTES`] of block metadata,
    /// so the parser's `u32` block offsets cannot address it.
    TooManyBlocks,
}

bun_core::oom_from_alloc!(ParserError);

impl core::fmt::Display for ParserError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(<&'static str>::from(*self))
    }
}

impl core::error::Error for ParserError {}

/// The longest `OFF`-typed fixed lookahead the parser performs from an
/// in-bounds offset: the `<![CDATA[` probe in `is_html_block_start_condition`
/// checks `off + MAX_LOOKAHEAD <= size`. (Probes that add in `usize`, like
/// `match_html_tag`, cannot wrap and do not bound this.)
pub(crate) const MAX_LOOKAHEAD: OFF = 1 + crate::line_analysis::CDATA_OPEN.len() as OFF;

/// The largest input `input_size` accepts. Every offset, mark and span
/// boundary in the parser is an `OFF` (u32), and bounds checks are written as
/// `off + k <= size` for fixed lookaheads `k`, so the input must leave
/// [`MAX_LOOKAHEAD`] bytes of headroom below `OFF::MAX` for that arithmetic
/// never to wrap.
pub const MAX_INPUT_LEN: usize = (OFF::MAX - MAX_LOOKAHEAD) as usize;

/// The most bytes `block_bytes` may hold: a block's offset into the buffer
/// is stored as a `u32` (`Container.block_byte_off` and the casts that feed
/// it), and each new header is written at the end of `block_bytes` rounded
/// up to its alignment, so the buffer must stop one aligned header short of
/// `OFF::MAX`.
pub(crate) const MAX_BLOCK_BYTES: usize =
    OFF::MAX as usize - (size_of::<BlockHeader>() + align_of::<BlockHeader>());

// The headroom proof: a buffer filled to the cap can still be aligned up and
// take one more header without leaving `OFF` range.
const _: () = assert!(
    ((MAX_BLOCK_BYTES + (align_of::<BlockHeader>() - 1)) & !(align_of::<BlockHeader>() - 1))
        + size_of::<BlockHeader>()
        <= OFF::MAX as usize
);

/// The runtime block-metadata cap checked by [`check_block_bytes_len`]:
/// always [`MAX_BLOCK_BYTES`] outside of tests, shrinkable only through
/// [`set_max_block_bytes_for_testing`].
static BLOCK_BYTES_LIMIT: AtomicUsize = AtomicUsize::new(MAX_BLOCK_BYTES);

/// `bun:internal-for-testing` (`setMaxMarkdownBlockBytesForTesting`): shrink
/// the block-metadata cap so the `TooManyBlocks` path is reachable without
/// allocating 4 GiB of headers. The cap can only be lowered, never raised
/// past [`MAX_BLOCK_BYTES`]. Returns the previous value so callers can
/// restore it.
pub fn set_max_block_bytes_for_testing(limit: usize) -> usize {
    BLOCK_BYTES_LIMIT.swap(limit.min(MAX_BLOCK_BYTES), Ordering::Relaxed)
}

/// Rejects growing `block_bytes` to `needed` bytes once the parser's u32
/// block offsets could no longer address it. Every site that grows the
/// buffer (`append_block_header`, `end_current_block`) checks this before
/// appending.
#[inline]
pub(crate) fn check_block_bytes_len(needed: usize) -> Result<(), ParserError> {
    if needed > BLOCK_BYTES_LIMIT.load(Ordering::Relaxed) {
        return Err(ParserError::TooManyBlocks);
    }
    Ok(())
}

/// Callers that size anything from the input length must reject oversized
/// inputs with this before allocating.
#[inline]
pub(crate) fn input_size(text: &[u8]) -> Result<OFF, ParserError> {
    if text.len() > MAX_INPUT_LEN {
        return Err(ParserError::InputTooLarge);
    }
    Ok(text.len() as OFF)
}

impl<'a> Parser<'a> {
    pub fn get_block_header_at(&mut self, off: usize) -> &mut BlockHeader {
        // SAFETY: `off` is produced by start_new_block / push_container_bytes which pad it
        // to a multiple of `align_of::<BlockHeader>()`, and the global allocator returns
        // blocks aligned to at least `align_of::<usize>()`, so the resulting pointer is
        // 4-byte aligned (asserted below). The buffer holds an initialized BlockHeader there.
        unsafe {
            let ptr = self
                .block_bytes
                .as_mut_ptr()
                .add(off)
                .cast::<c_void>()
                .cast::<BlockHeader>();
            debug_assert!(ptr.is_aligned());
            &mut *ptr
        }
    }

    #[inline]
    pub fn get_block_at(&mut self, off: usize) -> &mut BlockHeader {
        self.get_block_header_at(off)
    }

    /// Appends one aligned `BlockHeader` to `block_bytes` and returns its
    /// byte offset. This is the only way a header is added, so the
    /// block-metadata cap cannot be forgotten by a new caller.
    pub(crate) fn append_block_header(
        &mut self,
        header: BlockHeader,
    ) -> Result<usize, ParserError> {
        let align_mask: usize = align_of::<BlockHeader>() - 1;
        let aligned = (self.block_bytes.len() + align_mask) & !align_mask;
        let needed = aligned + size_of::<BlockHeader>();
        check_block_bytes_len(needed)?;
        self.block_bytes
            .reserve(needed.saturating_sub(self.block_bytes.len()));
        // Zero-fill to `needed`; bytes in [aligned, needed) are immediately
        // overwritten by the header write below.
        self.block_bytes.resize(needed, 0);
        *self.get_block_header_at(aligned) = header;
        Ok(aligned)
    }

    /// Charge one resolved reference link/image against the reference-definition
    /// output budget (`max_ref_def_output`). On exhaustion the budget is zeroed, so
    /// this and every later reference degrade to literal text (md4c, mity/md4c#238).
    pub(crate) fn charge_ref_def_output(&mut self, dest_len: usize, title_len: usize) -> bool {
        let n = dest_len as u64 + title_len as u64;
        if n < self.max_ref_def_output {
            self.max_ref_def_output -= n;
            true
        } else {
            self.max_ref_def_output = 0;
            false
        }
    }

    fn init(text: &'a [u8], flags: Flags, rend: Renderer<'a>) -> Result<Parser<'a>, ParserError> {
        let size = input_size(text)?;
        let mut p = Parser {
            text,
            size,
            flags,
            renderer: rend,
            image_nesting_level: 0,
            link_nesting_level: 0,
            code_indent_offset: if flags.no_indented_code_blocks {
                u32::MAX
            } else {
                4
            },
            doc_ends_with_newline: size > 0 && helpers::is_newline(text[(size - 1) as usize]),
            mark_char_map: MarkCharMap::init_empty(),
            marks: Vec::new(),
            containers: Vec::new(),
            block_bytes: Vec::new(),
            buffer: Vec::new(),
            emph_delims: Vec::new(),
            bracket_pairs: Vec::new(),
            label_frames: Vec::new(),
            html_scan_memo: Cell::new(HtmlScanMemo::EMPTY),
            n_containers: 0,
            current_block: None,
            current_block_lines: Vec::new(),
            opener_stacks: [(); NUM_OPENER_STACKS].map(|_| OpenerStack::default()),
            unresolved_link_head: -1,
            unresolved_link_tail: -1,
            table_cell_boundaries_head: -1,
            table_cell_boundaries_tail: -1,
            html_block_type: 0,
            fence_indent: 0,
            table_col_count: 0,
            table_alignments: [Align::Default; TABLE_MAXCOLCOUNT as usize],
            ref_defs: Vec::new(),
            ref_def_labels: bun_collections::StringSet::new(),
            last_line_has_list_loosening_effect: false,
            last_list_item_starts_with_two_blank_lines: false,
            max_ref_def_output: 16 * (size as u64).min(1024 * 1024 / 16),
            stack_check: StackCheck::init(),
        };
        p.build_mark_char_map();
        Ok(p)
    }

    // All owned buffers are `Vec<_>`, so `Drop` is automatic — no explicit impl.

    #[inline]
    pub fn ch(&self, off: OFF) -> u8 {
        if off >= self.size {
            return 0;
        }
        self.text[off as usize]
    }

    fn build_mark_char_map(&mut self) {
        self.mark_char_map.set(b'\\' as usize);
        self.mark_char_map.set(b'*' as usize);
        self.mark_char_map.set(b'_' as usize);
        self.mark_char_map.set(b'`' as usize);
        self.mark_char_map.set(b'&' as usize);
        self.mark_char_map.set(b';' as usize);
        self.mark_char_map.set(b'[' as usize);
        self.mark_char_map.set(b'!' as usize);
        self.mark_char_map.set(b']' as usize);
        self.mark_char_map.set(0);
        self.mark_char_map.set(b'\n' as usize); // newlines always need handling (hard/soft breaks)
        if !self.flags.no_html_spans {
            self.mark_char_map.set(b'<' as usize);
            self.mark_char_map.set(b'>' as usize);
        }
        if self.flags.strikethrough {
            self.mark_char_map.set(b'~' as usize);
        }
        if self.flags.latex_math {
            self.mark_char_map.set(b'$' as usize);
        }
        if self.flags.permissive_email_autolinks || self.flags.permissive_url_autolinks {
            self.mark_char_map.set(b':' as usize);
        }
        if self.flags.permissive_email_autolinks {
            self.mark_char_map.set(b'@' as usize);
        }
        if self.flags.permissive_www_autolinks {
            self.mark_char_map.set(b'.' as usize);
        }
        if self.flags.collapse_whitespace {
            self.mark_char_map.set(b' ' as usize);
            self.mark_char_map.set(b'\t' as usize);
            self.mark_char_map.set(b'\r' as usize);
        }
    }

    // ========================================
    // Delegated methods (re-exports)
    // ========================================
    //
    // Each sibling
    // module defines its own `impl Parser<'_> { ... }` block (multiple `impl`
    // blocks per type within one crate are idiomatic). The list below is kept
    // as documentation of where each method lives.
    //
    // render_blocks.rs — impl Parser:
    //   enter_block, leave_block, process_code_block, process_html_block,
    //   process_table_block, process_table_row
    //
    // blocks.rs — impl Parser:
    //   process_doc, analyze_line, process_line, start_new_block,
    //   add_line_to_current_block, end_current_block,
    //   consume_ref_defs_from_current_block, get_block_header_at, get_block_at
    //
    // containers.rs — impl Parser:
    //   push_container, push_container_bytes, enter_child_containers,
    //   leave_child_containers, is_container_compatible, process_all_blocks
    //
    // inlines.rs — impl Parser:
    //   process_leaf_block, process_inline_content, enter_span, leave_span,
    //   emit_text, emit_emph_open_tags, emit_emph_close_tags,
    //   find_code_span_end, normalize_code_span_content, is_left_flanking,
    //   is_right_flanking, can_open_emphasis, can_close_emphasis,
    //   collect_emphasis_delimiters, resolve_emphasis_delimiters, find_entity,
    //   find_html_tag
    //
    // links.rs — impl Parser:
    //   compute_bracket_matches, match_bracket, scan_bracket_close,
    //   enter_label_span, process_link, try_match_bracket_link,
    //   label_contains_link, process_wiki_link, find_autolink,
    //   render_autolink
    //
    // line_analysis.rs — impl Parser:
    //   is_setext_underline, is_hr_line, is_atx_header_line,
    //   is_opening_code_fence, is_closing_code_fence,
    //   is_html_block_start_condition, is_html_block_end_condition,
    //   match_html_tag, is_block_level_html_tag, is_complete_html_tag,
    //   is_table_underline, count_table_row_columns, is_container_mark
    //
    // ref_defs.rs — impl Parser:
    //   normalize_label, lookup_ref_def, parse_ref_def,
    //   skip_ref_def_whitespace, parse_ref_def_dest, parse_ref_def_title,
    //   build_ref_def_hashtable
}

// Silence unused-import warnings for the sibling modules referenced only in
// the doc-comment above.

// ========================================
// Public API
// ========================================

pub fn render_to_html(
    text: &[u8],
    flags: Flags,
    render_opts: RenderOptions,
) -> Result<Box<[u8]>, ParserError> {
    // Skip UTF-8 BOM
    let input = helpers::skip_utf8_bom(text);

    let mut html_renderer = HtmlRenderer::init(input, render_opts);

    let mut parser = Parser::init(input, flags, html_renderer.renderer())?;

    parser.process_doc()?;
    drop(parser);

    Ok(html_renderer.to_owned_slice()?)
}

/// Parse and render using a custom renderer. The caller provides its own
/// Renderer implementation (e.g. for JS callback-based rendering).
/// `render_options` carries render-only flags (tag_filter, heading_ids,
/// autolink_headings) so they are not silently dropped by the API.
pub fn render_with_renderer<'a>(
    text: &'a [u8],
    flags: Flags,
    render_options: RenderOptions,
    rend: Renderer<'a>,
) -> Result<(), ParserError> {
    let _ = render_options; // Available for renderer implementations; parse layer does not use these.
    let input = helpers::skip_utf8_bom(text);

    let mut p = Parser::init(input, flags, rend)?;

    p.process_doc()
}
