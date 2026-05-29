// Sub-modules

use core::cell::Cell;
use core::ffi::c_void;

use bun_collections::bit_set::{ArrayBitSet, num_masks_for};

pub type MarkCharMap = ArrayBitSet<256, { num_masks_for(256) }>;
use bun_core::StackCheck;

use super::helpers;
use super::html_renderer::HtmlRenderer;
use super::types::{
    Align, BlockType, Container, Flags, Mark, NUM_OPENER_STACKS, OFF, OpenerStack, Renderer,
    TABLE_MAXCOLCOUNT, VerbatimLine,
};
use crate::RenderOptions; // Zig: `root.RenderOptions` (root.zig → crate lib.rs)

// Re-exports that Zig nested under `Parser.*` — Rust has no struct-scoped type
// aliases, so they live at module scope as `parser::EmphDelim` etc.
pub use super::inlines::{EmphDelim, HtmlScanMemo, MAX_EMPH_MATCHES};
pub use super::ref_defs::RefDef;

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
    pub block_bytes: Vec<u8>,
    pub buffer: Vec<u8>,
    pub emph_delims: Vec<EmphDelim>,
    // Scratch storage recycled by compute_bracket_matches (links.rs) so inline
    // processing does not allocate a bracket-pair map per block.
    pub bracket_pairs: Vec<(OFF, OFF)>,
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
        // TODO(port): wire IntoStaticStr → interned tag; bun_core::err! only accepts ident
        bun_core::err!(ParserError)
    }
}

impl<'a> Parser<'a> {
    pub fn get_block_header_at(&mut self, off: usize) -> &mut BlockHeader {
        // SAFETY: `off` is produced by start_new_block / push_container_bytes which pad it
        // to a multiple of `align_of::<BlockHeader>()`, and the global allocator returns
        // blocks aligned to at least `align_of::<usize>()`, so the resulting pointer is
        // 4-byte aligned (asserted below). The buffer holds an initialized BlockHeader there.
        // TODO(port): borrowck — this returns &mut into self.block_bytes while other
        // &mut self borrows may be live at call sites; may need raw *mut.
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
            bracket_pairs: Vec::new(),
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
