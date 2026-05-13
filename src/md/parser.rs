// Sub-modules

use core::ffi::c_void as _; // (no FFI here; placeholder to mirror import block shape)

use bun_collections::bit_set::{ArrayBitSet, num_masks_for};

// Zig `bun.bit_set.StaticBitSet(256)` resolves to `ArrayBitSet(usize, 256)`
// (size > @bitSizeOf(usize)). Stable Rust cannot branch a type on a const
// generic, so per bit_set.rs guidance we pick `ArrayBitSet` directly. The
// inline scanner in inlines.rs depends on `is_set()` being real — a no-op
// stub here makes every byte fall through the fast path and disables all
// inline-span recognition (emphasis, links, code, entities, breaks).
pub type MarkCharMap = ArrayBitSet<256, { num_masks_for(256) }>;
use bun_core::StackCheck;

use super::blocks as blocks_mod;
use super::containers as containers_mod;
use super::helpers;
use super::html_renderer::HtmlRenderer;
use super::inlines as inlines_mod;
use super::line_analysis as line_analysis_mod;
use super::links as links_mod;
use super::ref_defs as ref_defs_mod;
use super::render_blocks as render_blocks_mod;
use super::types::{
    self, Align, BlockType, Container, Flags, Mark, NUM_OPENER_STACKS, OFF, OpenerStack, Renderer,
    TABLE_MAXCOLCOUNT, VerbatimLine,
};
use crate::RenderOptions; // Zig: `root.RenderOptions` (root.zig → crate lib.rs)

// Re-exports that Zig nested under `Parser.*` — Rust has no struct-scoped type
// aliases, so they live at module scope as `parser::EmphDelim` etc.
pub use super::inlines::{EmphDelim, MAX_EMPH_MATCHES};
pub use super::ref_defs::RefDef;

/// Parser context holding all state during parsing.
// TODO(port): lifetime — `text` is a caller-owned borrow for the parser's
// lifetime. PORTING.md says "no struct lifetimes in Phase A", but raw-ptr here
// would obscure every `ch()` call; one obvious `'a` is the honest mapping.
pub struct Parser<'a> {
    // Zig field `std.mem.Allocator` param — dropped; global mimalloc.
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
    // TODO(port): Zig uses `ArrayListAlignedUnmanaged(u8, .@"4")` — 4-byte
    // alignment is load-bearing for `BlockHeader` reinterpretation via
    // `getBlockHeaderAt`. Phase B: wrap in an aligned-vec newtype or store
    // `Vec<u32>` and byte-view it.
    pub block_bytes: Vec<u8>,
    pub buffer: Vec<u8>,
    pub emph_delims: Vec<EmphDelim>,

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
    pub ref_def_labels: std::collections::HashSet<Box<[u8]>>,

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

/// `Parser.Error` in Zig is `bun.JSError || bun.StackOverflow`, i.e. the union
/// of `{ OutOfMemory, JSError, JSTerminated }` with `{ StackOverflow }`.
// TODO(port): narrow error set — `bun_jsc::JsError` already covers the first
// three; Phase B may want `enum { Js(JsError), StackOverflow }` instead.
// TODO(b1): thiserror/strum not in workspace deps — derive dropped, hand-roll if needed.
pub type Error = ParserError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParserError {
    OutOfMemory,
    JSError,
    JSTerminated,
    StackOverflow,
}

bun_core::oom_from_alloc!(ParserError);

impl From<ParserError> for bun_core::Error {
    fn from(_e: ParserError) -> Self {
        // TODO(b1): wire IntoStaticStr → interned tag; bun_core::err! only accepts ident
        bun_core::err!(ParserError)
    }
}

impl<'a> Parser<'a> {
    pub fn get_block_header_at(&mut self, off: usize) -> &mut BlockHeader {
        // SAFETY: off is an aligned offset into block_bytes produced by start_new_block /
        // push_container_bytes; the buffer holds a valid BlockHeader at that offset.
        // TODO(port): borrowck — this returns &mut into self.block_bytes while other
        // &mut self borrows may be live at call sites; Phase B may need raw *mut.
        unsafe { &mut *(self.block_bytes.as_mut_ptr().add(off).cast::<BlockHeader>()) }
    }

    #[inline]
    pub fn get_block_at(&mut self, off: usize) -> &mut BlockHeader {
        self.get_block_header_at(off)
    }

    fn init(text: &'a [u8], flags: Flags, rend: Renderer<'a>) -> Parser<'a> {
        let size: OFF = OFF::try_from(text.len()).expect("int cast");
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
            ref_def_labels: std::collections::HashSet::new(),
            last_line_has_list_loosening_effect: false,
            last_list_item_starts_with_two_blank_lines: false,
            max_ref_def_output: (16 * (size as u64)).min(1024 * 1024).min(u32::MAX as u64),
            stack_check: StackCheck::init(),
        };
        p.build_mark_char_map();
        p
    }

    // Zig `fn deinit(self: *Parser)` only frees the `ArrayListUnmanaged` fields.
    // All of those are now `Vec<_>`, so `Drop` is automatic — no explicit impl.

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
    // In Zig these are `pub const foo = other_mod.foo;` aliases that pull free
    // functions into `Parser`'s decl namespace so they dispatch as methods
    // (`parser.foo(...)`). Rust has no decl-aliasing; instead each sibling
    // module defines its own `impl Parser<'_> { ... }` block (multiple `impl`
    // blocks per type within one crate are idiomatic). The list below is kept
    // as documentation so the .zig ↔ .rs diff stays line-aligned.
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
    //   process_link, try_match_bracket_link, label_contains_link,
    //   process_wiki_link, render_ref_link, find_autolink, render_autolink
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
// the doc-comment above; Phase B removes once `impl Parser` blocks land.
#[allow(unused_imports)]
use {
    blocks_mod as _, containers_mod as _, inlines_mod as _, line_analysis_mod as _, links_mod as _,
    ref_defs_mod as _, render_blocks_mod as _, types as _,
};

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
    // Zig `errdefer html_renderer.deinit()` — Drop handles cleanup on `?`.

    let mut parser = Parser::init(input, flags, html_renderer.renderer());
    // Zig `defer parser.deinit()` — Drop handles cleanup at scope exit.

    // HtmlRenderer never returns JSError/JSTerminated, so OutOfMemory is the only possible error.
    match parser.process_doc() {
        Ok(()) => {}
        Err(ParserError::OutOfMemory) => return Err(ParserError::OutOfMemory),
        Err(ParserError::JSError) | Err(ParserError::JSTerminated) => unreachable!(),
        Err(ParserError::StackOverflow) => return Err(ParserError::StackOverflow),
    }
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

    let mut p = Parser::init(input, flags, rend);
    // Zig `defer p.deinit()` — Drop.

    p.process_doc()
}

// ported from: src/md/parser.zig
