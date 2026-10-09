// Sub-modules

use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicUsize, Ordering};

// What a byte can mean in inline content: `MARK_*`. 0: nothing, and the scans
// in inlines.rs and links.rs do not look at it.
pub(crate) type MarkCharMap = [u8; 256];
/// `[`
pub(crate) const MARK_OPENER: u8 = 1 << 0;
/// `]`
pub(crate) const MARK_CLOSER: u8 = 1 << 1;
/// `*`, `_`, `~`
pub(crate) const MARK_DELIMITER: u8 = 1 << 2;
/// `hidden_at` can find something at it.
pub(crate) const MARK_HIDES: u8 = 1 << 3;
pub(crate) const MARK_OTHER: u8 = 1 << 4;
use bun_core::StackCheck;

use super::helpers;
use super::html_renderer::HtmlRenderer;
use super::types::{
    Align, BlockType, Container, Flags, OFF, Renderer, TABLE_MAXCOLCOUNT, VerbatimLine,
};
use crate::RenderOptions;

// Rust has no struct-scoped type
// aliases, so these live at module scope as `parser::EmphDelim` etc.
pub(crate) use super::inlines::{EmphDelim, HtmlScanMemo};
pub(crate) use super::ref_defs::RefDef;

/// Parser context holding all state during parsing.
// `text` is a caller-owned borrow for the parser's lifetime.
// PORTING.md's mechanical-port guidance was "no struct lifetimes", but raw-ptr
// here would obscure every `ch()` call; one obvious `'a` is the honest mapping.
pub(crate) struct Parser<'a> {
    pub(crate) text: &'a [u8],
    pub(crate) size: OFF,
    pub(crate) has_carriage_return: bool,
    pub(crate) flags: Flags,

    // Output
    pub(crate) renderer: Renderer<'a>,
    pub(crate) image_nesting_level: u32,
    pub(crate) link_nesting_level: u32,

    // Code indent offset: 4 normally, maxInt if no_indented_code_blocks
    pub(crate) code_indent_offset: u32,

    // Mark character map — the characters that need special handling
    pub(crate) mark_char_map: MarkCharMap,
    // Where the bytes of the inline content that is being processed are that
    // `mark_char_map` has, and all that they can mean.
    pub(crate) marks: Vec<OFF>,
    pub(crate) marks_seen: u8,
    // What hides markers in that content, in its order.
    pub(crate) hidden: Vec<crate::inlines::Hidden>,

    // Dynamic arrays
    pub(crate) containers: Vec<Container>,
    // 4-byte alignment is
    // load-bearing for the `BlockHeader` reinterpretation in
    // `get_block_header_at`. Here the invariant rests on (a) offsets being
    // padded to a multiple of 4 by every writer and (b) the global allocator
    // returning >=16-byte-aligned bases; `get_block_header_at`
    // debug-asserts it on every access.
    pub(crate) block_bytes: Vec<u8>,
    pub(crate) buffer: Vec<u8>,
    pub(crate) emph_delims: Vec<EmphDelim>,
    // Scratch storage recycled by resolve_emphasis_delimiters (inlines.rs).
    pub(crate) prev_candidate: Vec<usize>,
    // Scratch storage recycled by compute_bracket_matches (links.rs) so inline
    // processing does not allocate a bracket-pair map per block.
    pub(crate) bracket_pairs: Vec<crate::links::Bracket>,
    // Label-frame stack recycled by process_inline_content (inlines.rs) so
    // blocks with links do not allocate a frame stack per block.
    pub(crate) label_frames: Vec<crate::inlines::LabelFrame>,
    // Memo of failed closing-delimiter searches in find_html_tag (inlines.rs).
    // Cell because find_html_tag is a &self query reached from both &self and
    // &mut self scanners.
    pub(crate) html_scan_memo: Cell<HtmlScanMemo>,
    // No thematic break starts between these two places. See `is_hr_line`.
    pub(crate) not_hr: Cell<(OFF, OFF)>,

    // Number of active containers
    pub(crate) n_containers: u32,

    // Current block being built
    pub(crate) current_block: Option<usize>,
    pub(crate) current_block_lines: Vec<VerbatimLine>,

    // HTML block tracking
    pub(crate) html_block_type: u8,
    // Fenced code block indent
    pub(crate) fence_indent: u32,

    // Table column alignments
    pub(crate) table_alignments: [Align; TABLE_MAXCOLCOUNT as usize],

    // Ref defs
    pub(crate) ref_defs: Vec<RefDef>,
    pub(crate) ref_def_labels: bun_collections::StringSet,

    // State
    pub(crate) last_line_has_list_loosening_effect: bool,
    pub(crate) last_list_item_starts_with_two_blank_lines: bool,
    // The last header in `block_bytes` is the opener of a list item.
    pub(crate) last_header_opens_list_item: bool,
    pub(crate) max_ref_def_output: u64,

    // Stack overflow protection for recursive inline processing
    pub(crate) stack_check: StackCheck,
}

#[repr(C)]
pub struct BlockHeader {
    pub(crate) block_type: BlockType,
    pub(crate) _pad: [u8; 3],
    pub(crate) flags: u32,
    pub(crate) data: u32,
    pub(crate) n_lines: u32,
}

/// `Parser`'s error type: the union of `{ OutOfMemory, JSError }`
/// with the parser-specific `{ StackOverflow, InputTooLarge, TooManyBlocks }`.
// (`bun_jsc::JsError` covers the first two, but the md crate sits below
// `bun_jsc` in the layering, so the variants stay flat here.)
pub(crate) type Error = ParserError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ParserError {
    OutOfMemory,
    JSError,
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
const MAX_BLOCK_BYTES: usize =
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
    pub(crate) fn get_block_header_at(&mut self, off: usize) -> &mut BlockHeader {
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
    pub(crate) fn get_block_at(&mut self, off: usize) -> &mut BlockHeader {
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
        self.last_header_opens_list_item = header.block_type == BlockType::Li
            && header.flags & crate::types::BLOCK_CONTAINER_OPENER != 0;
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
            has_carriage_return: bun_core::strings::contains_char(text, b'\r'),
            flags,
            renderer: rend,
            image_nesting_level: 0,
            link_nesting_level: 0,
            code_indent_offset: if flags.no_indented_code_blocks {
                u32::MAX
            } else {
                4
            },
            mark_char_map: [0; 256],
            marks: Vec::new(),
            marks_seen: 0,
            hidden: Vec::new(),
            containers: Vec::new(),
            block_bytes: Vec::new(),
            buffer: Vec::new(),
            emph_delims: Vec::new(),
            prev_candidate: Vec::new(),
            bracket_pairs: Vec::new(),
            label_frames: Vec::new(),
            html_scan_memo: Cell::new(HtmlScanMemo::EMPTY),
            not_hr: Cell::new((0, 0)),
            n_containers: 0,
            current_block: None,
            current_block_lines: Vec::new(),
            html_block_type: 0,
            fence_indent: 0,
            table_alignments: [Align::Default; TABLE_MAXCOLCOUNT as usize],
            ref_defs: Vec::new(),
            ref_def_labels: bun_collections::StringSet::new(),
            last_line_has_list_loosening_effect: false,
            last_list_item_starts_with_two_blank_lines: false,
            last_header_opens_list_item: false,
            max_ref_def_output: 16 * (size as u64).min(1024 * 1024 / 16),
            stack_check: StackCheck::init(),
        };
        p.build_mark_char_map();
        Ok(p)
    }

    // All owned buffers are `Vec<_>`, so `Drop` is automatic — no explicit impl.

    #[inline]
    pub(crate) fn ch(&self, off: OFF) -> u8 {
        if off >= self.size {
            return 0;
        }
        self.text[off as usize]
    }

    fn build_mark_char_map(&mut self) {
        let flags = self.flags;
        let map = &mut self.mark_char_map;
        // newlines always need handling (hard/soft breaks)
        for c in [b'\\', b'&', b'!', 0, b'\n'] {
            map[c as usize] = MARK_OTHER;
        }
        map[b'*' as usize] = MARK_DELIMITER;
        map[b'_' as usize] = MARK_DELIMITER;
        map[b'`' as usize] = MARK_HIDES;
        map[b'[' as usize] = MARK_OPENER;
        map[b']' as usize] = MARK_CLOSER;
        if !flags.no_html_spans {
            map[b'<' as usize] = MARK_HIDES;
        }
        if flags.strikethrough {
            map[b'~' as usize] = MARK_DELIMITER;
        }
        if flags.latex_math {
            map[b'$' as usize] = MARK_OTHER;
        }
        if flags.permissive_email_autolinks || flags.permissive_url_autolinks {
            map[b':' as usize] = MARK_OTHER;
        }
        if flags.permissive_email_autolinks {
            map[b'@' as usize] = MARK_OTHER;
        }
        if flags.permissive_www_autolinks {
            map[b'.' as usize] = MARK_OTHER;
        }
        if flags.collapse_whitespace {
            for c in [b' ', b'\t', b'\r'] {
                map[c as usize] = MARK_OTHER;
            }
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
    //   compute_bracket_matches, enter_label_span, process_link,
    //   link_end_behind, process_wiki_link, find_autolink,
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

pub(crate) fn render_to_html(
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
pub(crate) fn render_with_renderer<'a>(
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
