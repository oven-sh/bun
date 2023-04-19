const std = @import("std");
const logger = @import("root").bun.logger;
const mdx_lexer = @import("./mdx_lexer.zig");
const Lexer = mdx_lexer.Lexer;
const importRecord = @import("../import_record.zig");
const js_ast = bun.JSAst;
const JSParser = @import("../js_parser/js_parser.zig").MDXParser;
const ParseStatementOptions = @import("../js_parser/js_parser.zig").ParseStatementOptions;

const options = @import("../options.zig");

const fs = @import("../fs.zig");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const expect = std.testing.expect;
const ImportKind = importRecord.ImportKind;
const BindingNodeIndex = js_ast.BindingNodeIndex;
const Define = @import("../defines.zig").Define;
const js_lexer = bun.js_lexer;
const StmtNodeIndex = js_ast.StmtNodeIndex;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const StmtNodeList = js_ast.StmtNodeList;
const BindingNodeList = js_ast.BindingNodeList;
const ParserOptions = @import("../js_parser/js_parser.zig").Parser.Options;
const runVisitPassAndFinish = @import("../js_parser/js_parser.zig").Parser.runVisitPassAndFinish;
const Ref = @import("../ast/base.zig").Ref;
const assert = std.debug.assert;
const BabyList = js_ast.BabyList;

const LocRef = js_ast.LocRef;
const S = js_ast.S;
const B = js_ast.B;
const G = js_ast.G;
const T = mdx_lexer.T;
const E = js_ast.E;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const Binding = js_ast.Binding;
const Symbol = js_ast.Symbol;
const Level = js_ast.Op.Level;
const Op = js_ast.Op;
const Scope = js_ast.Scope;
const Range = logger.Range;

pub const Container = struct {
    ch: u8 = 0,
    is_loose: bool = false,
    is_task: bool = false,
    start: u32 = 0,
    mark_indent: u32 = 0,
    contents_indent: u32 = 0,
    block_index: u32 = 0,
    task_mark_off: u32 = 0,
};

pub const Block = struct {
    tag: Tag = Tag.html,
    flags: Block.Flags.Set = Block.Flags.Set{},
    data: u32 = 0,
    /// Leaf blocks:     Count of lines (MD_LINE or MD_VERBATIMLINE) on the block.
    /// LI:     Task mark offset in the input doc.
    /// OL:     Start item number.
    ///
    line_count: u32 = 0,
    line_offset: u32 = 0,
    detail: Block.Detail = Block.Detail{ .none = .{} },

    pub inline fn lines(this: Block, lines_: BabyList(Line)) []Line {
        return lines_.ptr[this.line_offset .. this.line_offset + this.line_count];
    }

    pub inline fn verbatimLines(this: Block, lines_: BabyList(Line.Verbatim)) []Line.Verbatim {
        return lines_.ptr[this.line_offset .. this.line_offset + this.line_count];
    }

    pub const Data = u32;

    pub const Flags = enum(u3) {
        container_opener = 0,
        container_closer = 1,
        loose_list = 2,
        setext_header = 3,

        pub const Set = std.enums.EnumSet(Block.Flags);
    };

    pub inline fn isContainer(this: Block) bool {
        return this.flags.contains(.container_opener) or this.flags.contains(.container_closer);
    }

    pub const Tag = enum {
        /// <body>...</body>
        doc,

        /// <blockquote>...</blockquote>
        quote,

        /// <ul>...</ul>
        ///Detail: Structure ul_detail.
        ul,

        /// <ol>...</ol>
        ///Detail: Structure ol_detail.
        ol,

        /// <li>...</li>
        ///Detail: Structure li_detail.
        li,

        /// <hr>
        hr,

        /// <h1>...</h1> (for levels up to 6)
        ///Detail: Structure h_detail.
        h,

        /// <pre><code>...</code></pre>
        ///Note the text lines within code blocks are terminated with '\n'
        ///instead of explicit MD_TEXT_BR.
        code,

        /// Raw HTML block. This itself does not correspond to any particular HTML
        ///tag. The contents of it _is_ raw HTML source intended to be put
        ///in verbatim form to the HTML output.
        html,

        /// <p>...</p>
        p,

        /// <table>...</table> and its contents.
        ///Detail: Structure table_detail (for table),
        ///        structure td_detail (for th and td)
        ///Note all of these are used only if extension MD_FLAG_TABLES is enabled.
        table,
        thead,
        tbody,
        tr,
        th,
        td,
    };

    pub const UL = struct {
        tight: bool = false,
        mark: u8 = '*',
    };

    pub const OL = struct {
        start: u32 = 0,
        tight: bool = false,
        mark: u8 = '*',
    };

    pub const LI = struct {
        /// Can be non-zero only with MD_FLAG_TASKLISTS
        task: bool = false,
        /// is_task, then one of 'x', 'X' or ' '. Undefined otherwise.
        task_mark: u8 = 'x',
        /// If is_task, then offset in the input of the char between '[' and ']'.
        task_mark_off: u32 = 0,
    };

    pub const Header = u4;

    pub const Code = struct {
        info: Attribute = .{},
        lang: Attribute = .{},
        /// character used for fenced code block; or zero for indented code block. *
        fence: u8 = '`',
    };

    pub const Table = struct {
        /// Count of columns in the table.
        column_count: u32 = 0,
        /// Count of rows in the table header (currently always 1)
        head_row_count: u32 = 1,
        /// Count of rows in the table body
        body_row_count: u32 = 0,
    };

    pub const Detail = union {
        none: void,
        ul: UL,
        ol: OL,
        li: LI,
    };

    pub const TD = struct {
        alignment: Align = Align.default,
    };
};
pub const Span = struct {
    pub const Tag = enum {
        /// <em>...</em>
        em,

        /// <strong>...</strong>
        strong,

        /// <a href="xxx">...</a>
        /// Detail: Structure a_detail.
        a,

        /// <img src="xxx">...</a>
        /// Detail: Structure img_detail.
        /// Note: Image text can contain nested spans and even nested images.
        /// If rendered into ALT attribute of HTML <IMG> tag, it's responsibility
        /// of the parser to deal with it.
        img,

        /// <code>...</code>
        code,

        /// <del>...</del>
        /// Note: Recognized only when MD_FLAG_STRIKETHROUGH is enabled.
        del,

        /// For recognizing inline ($) and display ($$) equations
        /// Note: Recognized only when MD_FLAG_LATEXMATHSPANS is enabled.
        latexmath,
        latexmath_display,

        /// Wiki links
        /// Note: Recognized only when MD_FLAG_WIKILINKS is enabled.
        wikilink,

        /// <u>...</u>
        /// Note: Recognized only when MD_FLAG_UNDERLINE is enabled.
        u,
    };

    pub const Link = struct {
        src: Attribute = .{},
        title: Attribute = .{},
    };

    pub const Image = Link;

    pub const Wikilink = struct {
        target: Attribute = .{},
    };
};

pub const Text = enum {
    /// Normal text.
    normal,
    /// NULL character. CommonMark requires replacing NULL character with
    /// the replacement char U+FFFD, so this allows caller to do that easily.
    nullchar,
    /// Line breaks.
    /// Note these are not sent from blocks with verbatim output (MD_BLOCK_CODE
    /// or MD_BLOCK_HTML). In such cases, '\n' is part of the text itself.
    /// <br> (hard break)
    br,
    /// '\n' in source text where it is not semantically meaningful (soft break)
    softbr,
    /// Entity.
    /// (a) Named entity, e.g. &nbsp;
    ///     (Note MD4C does not have a list of known entities.
    ///     Anything matching the regexp /&[A-Za-z][A-Za-z0-9]{1,47};/ is
    ///     treated as a named entity.)
    /// (b) Numerical entity, e.g. &#1234;
    /// (c) Hexadecimal entity, e.g. &#x12AB;
    ///
    /// As MD4C is mostly encoding agnostic, application gets the verbatim
    /// entity text into the MD_PARSER::text_callback().
    entity,
    /// Text in a code block (inside MD_BLOCK_CODE) or inlined code (`code`).
    /// If it is inside MD_BLOCK_CODE, it includes spaces for indentation and
    /// '\n' for new lines. br and softbr are not sent for this
    /// kind of text.
    code,
    /// Text is a raw HTML. If it is contents of a raw HTML block (i.e. not
    /// an inline raw HTML), then br and softbr are not used.
    /// The text contains verbatim '\n' for the new lines.
    html,
    /// Text is inside an equation. This is processed the same way as inlined code
    /// spans (`code`).
    latexmath,
};
pub const Align = enum(u3) {
    default = 0,
    left = 1,
    center = 2,
    right = 3,
};

/// String attribute.
///
/// This wraps strings which are outside of a normal text flow and which are
/// propagated within various detailed structures, but which still may contain
/// string portions of different types like e.g. entities.
///
/// So, for example, lets consider this image:
///
///     ![image alt text](http://example.org/image.png 'foo &quot; bar')
///
/// The image alt text is propagated as a normal text via the MD_PARSER::text()
/// callback. However, the image title ('foo &quot; bar') is propagated as
/// MD_ATTRIBUTE in MD_SPAN_IMG_DETAIL::title.
///
/// Then the attribute MD_SPAN_IMG_DETAIL::title shall provide the following:
///  -- [0]: "foo "   (substr_types[0] == MD_TEXT_NORMAL; substr_offsets[0] == 0)
///  -- [1]: "&quot;" (substr_types[1] == MD_TEXT_ENTITY; substr_offsets[1] == 4)
///  -- [2]: " bar"   (substr_types[2] == MD_TEXT_NORMAL; substr_offsets[2] == 10)
///  -- [3]: (n/a)    (n/a                              ; substr_offsets[3] == 14)
///
/// Note that these invariants are always guaranteed:
///  -- substr_offsets[0] == 0
///  -- substr_offsets[LAST+1] == size
///  -- Currently, only MD_TEXT_NORMAL, MD_TEXT_ENTITY, MD_TEXT_NULLCHAR
///     substrings can appear. This could change only of the specification
///     changes.
///
pub const Attribute = struct {
    text: []const u8 = "",
    substring: Substring.List = .{},
};
pub const Substring = struct {
    offset: u32,
    tag: Text,

    pub const List = std.MultiArrayList(Substring);
    pub const ListPool = ObjectPool(List);
};

pub const Mark = struct {
    position: Ref = Ref.None,
    prev: u32 = std.math.maxInt(u32),
    next: u32 = std.math.maxInt(u32),
    ch: u8 = 0,
    flags: u16 = 0,

    /// Maybe closer.
    pub const potential_closer = 0x02;
    /// Maybe opener.
    pub const potential_opener = 0x01;
    /// Definitely opener.
    pub const opener = 0x04;
    /// Definitely closer.
    pub const closer = 0x08;
    /// Resolved in any definite way.
    pub const resolved = 0x10;

    /// Helper for the "rule of 3". */
    pub const emph_intraword = 0x20;
    pub const emph_mod3_0 = 0x40;
    pub const emph_mod3_1 = 0x80;
    pub const emph_mod3_2 = (0x40 | 0x80);
    pub const emph_mod3_mask = (0x40 | 0x80);
    /// Distinguisher for '<', '>'. */
    pub const autolink = 0x20;
    /// For permissive autolinks. */
    pub const validpermissiveautolink = 0x20;
    /// For '[' to rule out invalid link labels early */
    pub const hasnestedbrackets = 0x20;

    /// During analyzes of inline marks, we need to manage some "mark chains",
    /// of (yet unresolved) openers. This structure holds start/end of the chain.
    /// The chain internals are then realized through MD_MARK::prev and ::next.
    pub const Chain = struct {
        head: u32 = std.math.maxInt(u32),
        tail: u32 = std.math.maxInt(u32),

        pub const List = struct {
            data: [13]Chain = [13]Chain{ .{}, .{}, .{}, .{}, .{}, .{}, .{}, .{}, .{}, .{}, .{}, .{} },
            pub inline fn ptr_chain(this: *List) *Chain {
                return &this.data[0];
            }
            pub inline fn tablecellboundaries(this: *List) *Chain {
                return &this.data[1];
            }
            pub inline fn asterisk_openers_extraword_mod3_0(this: *List) *Chain {
                return &this.data[2];
            }
            pub inline fn asterisk_openers_extraword_mod3_1(this: *List) *Chain {
                return &this.data[3];
            }
            pub inline fn asterisk_openers_extraword_mod3_2(this: *List) *Chain {
                return &this.data[4];
            }
            pub inline fn asterisk_openers_intraword_mod3_0(this: *List) *Chain {
                return &this.data[5];
            }
            pub inline fn asterisk_openers_intraword_mod3_1(this: *List) *Chain {
                return &this.data[6];
            }
            pub inline fn asterisk_openers_intraword_mod3_2(this: *List) *Chain {
                return &this.data[7];
            }
            pub inline fn underscore_openers(this: *List) *Chain {
                return &this.data[8];
            }
            pub inline fn tilde_openers_1(this: *List) *Chain {
                return &this.data[9];
            }
            pub inline fn tilde_openers_2(this: *List) *Chain {
                return &this.data[10];
            }
            pub inline fn bracket_openers(this: *List) *Chain {
                return &this.data[11];
            }
            pub inline fn dollar_openers(this: *List) *Chain {
                return &this.data[12];
            }
        };
    };
};

pub const Line = struct {
    beg: u32 = 0,
    end: u32 = 0,

    pub const Tag = enum(u32) {
        blank,
        hr,
        atx_header,
        setext_header,
        setext_underline,
        indented_code,
        fenced_code,
        html,
        text,
        table,
        table_underline,
    };
    pub const Analysis = packed struct {
        tag: Tag = Tag.blank,
        beg: u32 = 0,
        end: u32 = 0,
        indent: u32 = 0,
        data: u32 = 0,

        pub const blank = Analysis{};
        pub fn eql(a: Analysis, b: Analysis) bool {
            return strings.eqlLong(std.mem.asBytes(&a), std.mem.asBytes(&b), false);
        }
    };

    pub const Verbatim = struct {
        line: Line = Line{},
        indent: u32 = 0,
    };
};

pub const MDParser = struct {
    marks: BabyList(Mark) = .{},
    chain: Mark.Chain.List = .{},
    source: logger.Source,
    flags: Flags.Set = Flags.commonmark,
    allocator: std.mem.Allocator,
    mdx: *MDX,
    mark_char_map: [255]u1 = undefined,
    doc_ends_with_newline: bool = false,
    size: u32 = 0,

    lines: BabyList(Line) = .{},
    verbatim_lines: BabyList(Line.Verbatim) = .{},

    containers: BabyList(Container) = .{},
    blocks: BabyList(Block) = .{},
    current_block: ?*Block = null,
    current_block_index: u32 = 0,

    code_fence_length: u32 = 0,
    code_indent_offset: u32 = std.math.maxInt(u32),
    last_line_has_list_loosening_effect: bool = false,
    last_list_item_starts_with_two_blank_lines: bool = false,

    pub const Flags = enum {
        /// In MD_TEXT_NORMAL, collapse non-trivial whitespace into single ' '
        collapse_whitespace,
        /// Do not require space in ATX headers ( ###header )
        permissive_atxheaders,
        /// Recognize URLs as autolinks even without '<', '>'
        permissive_url_autolinks,
        /// Recognize e-mails as autolinks even without '<', '>' and 'mailto:'
        permissive_email_autolinks,
        /// Disable indented code blocks. (Only fenced code works.)
        noindented_codeblocks,
        /// Disable raw HTML blocks.
        no_html_blocks,
        /// Disable raw HTML (inline).
        no_html_spans,
        /// Enable tables extension.
        tables,
        /// Enable strikethrough extension.
        strikethrough,
        /// Enable WWW autolinks (even without any scheme prefix, if they begin with 'www.')
        permissive_www_autolinks,
        /// Enable task list extension.
        tasklists,
        /// Enable $ and $$ containing LaTeX equations.
        latex_mathspans,
        /// Enable wiki links extension.
        wikilinks,
        /// Enable underline extension (and disables '_' for normal emphasis).
        underline,

        pub const Set = std.enums.EnumSet(Flags);
        pub const permissive_autolinks = Set.init(.{ .permissive_email_autolinks = true, .permissive_url_autolinks = true });
        pub const no_email = Set.init(.{ .no_html_blocks = true, .no_html_spans = true });
        pub const github = Set.init(.{ .tables = true, .permissive_autolinks = true, .strikethrough = true, .tasklists = true });
        pub const commonmark: i32 = Set{};
    };

    fn buildCharMap(this: *MDParser) void {
        @memset(&this.mark_char_map, 0, this.mark_char_map.len);

        this.mark_char_map['\\'] = 1;
        this.mark_char_map['*'] = 1;
        this.mark_char_map['_'] = 1;
        this.mark_char_map['`'] = 1;
        this.mark_char_map['&'] = 1;
        this.mark_char_map[';'] = 1;
        this.mark_char_map['<'] = 1;
        this.mark_char_map['>'] = 1;
        this.mark_char_map['['] = 1;
        this.mark_char_map['!'] = 1;
        this.mark_char_map[']'] = 1;
        this.mark_char_map[0] = 1;

        // whitespace
        this.mark_char_map[' '] = 1;
        this.mark_char_map['\t'] = 1;
        this.mark_char_map['\r'] = 1;
        this.mark_char_map['\n'] = 1;

        // form feed
        this.mark_char_map[0xC] = 1;
        // vertical tab
        this.mark_char_map[0xB] = 1;

        if (this.flags.contains(.strikethrough)) {
            this.mark_char_map['~'] = 1;
        }

        if (this.flags.contains(.latex_mathspans)) {
            this.mark_char_map['$'] = 1;
        }

        if (this.flags.contains(.permissive_email_autolinks)) {
            this.mark_char_map['@'] = 1;
        }

        if (this.flags.contains(.permissive_url_autolinks)) {
            this.mark_char_map[':'] = 1;
        }

        if (this.flags.contains(.permissive_www_autolinks)) {
            this.mark_char_map['.'] = 1;
        }

        if (this.flags.contains(.tables)) {
            this.mark_char_map['.'] = 1;
        }
    }
    pub fn init(allocator: std.mem.Allocator, source: logger.Source, flags: Flags.Set, mdx: *MDX) MDParser {
        var parser = MDParser{
            .allocator = allocator,
            .source = source,
            .flags = flags,
            .mdx = mdx,
            .size = @truncate(u32, source.contents.len),
        };
        parser.buildCharMap();
        parser.doc_ends_with_newline = source.contents.len.len > 0 and source.contents[source.contents.len - 1] == '\n';
        return parser;
    }

    fn startNewBlock(this: *MDParser, line: *const Line.Analysis) !void {
        try this.blocks.push(
            this.allocator,
            Block{
                .tag = switch (line.tag) {
                    .hr => Block.Tag.hr,
                    .atx_header, .setext_header => Block.Tag.h,
                    .fenced_code, .indented_code => Block.Tag.code,
                    .text => Block.Tag.p,
                    .html => Block.Tag.html,
                    else => unreachable,
                },
                .data = line.data,
                .line_count = 0,
                .line_offset = switch (line.tag) {
                    .indented_code, .html, .fenced_code => this.verbatim_lines.len,
                    else => this.lines.len,
                },
            },
        );
    }

    inline fn charAt(this: *const MDParser, index: u32) u8 {
        return this.source.contents[index];
    }

    inline fn isNewline(this: *const MDParser, index: u32) bool {
        return switch (this.charAt(index)) {
            '\n', '\r' => true,
            else => false,
        };
    }

    inline fn isAnyOf2(this: *const MDParser, index: u32, comptime first: u8, comptime second: u8) bool {
        return isAnyOf2_(this.charAt(index), first, second);
    }

    inline fn isAnyOf2_(char: u8, comptime first: u8, comptime second: u8) bool {
        return switch (char) {
            first, second => true,
            else => false,
        };
    }

    inline fn isAnyOf(this: *const MDParser, index: u32, comptime values: []const u8) bool {
        return isCharAnyOf(this.charAt(index), values);
    }

    inline fn isCharAnyOf(char: u8, comptime values: []const u8) bool {
        inline for (values) |val| {
            if (val == char) return true;
        }
        return false;
    }

    inline fn isBlank(char: u8) bool {
        return isCharAnyOf(char, &[_]u8{ ' ', '\t' });
    }

    inline fn isWhitespace(char: u8) bool {
        return isCharAnyOf(char, &[_]u8{ ' ', '\t', 0xC, 0xB });
    }

    pub fn getIndent(this: *MDParser, total_indent: u32, beg: u32, end: *u32) u32 {
        var off = beg;
        var indent = total_indent;
        while (off < this.size and isBlank(this.charAt(off))) {
            if (this.charAt(off) == '\t') {
                indent = (indent + 4) & ~3;
            } else {
                indent += 1;
            }
            off += 1;
        }
        end.* = off;
        return indent - total_indent;
    }

    pub fn isContainerMark(this: *MDParser, indent: u32, beg: u32, end: *u32, container: *Container) bool {
        var off = beg;
        var max_end: u32 = undefined;

        if (off >= this.size or indent >= this.code_indent_offset)
            return false;

        if (this.charAt(off) == '>') {
            off += 1;
            container.ch = '>';
            container.is_loose = false;
            container.is_task = false;
            container.mark_indent = indent;
            container.contents_indent = indent + 1;
            end.* = off;
            return true;
        }

        // Check for list item bullet mark.
        if (this.isAnyOf(off, "-+*") and (off + 1 >= this.size or isBlank(this.charAt(off + 1)) or this.isNewline(off + 1))) {
            container.ch = this.charAt(off);
            container.is_loose = false;
            container.is_task = false;
            container.mark_indent = indent;
            container.contents_indent = indent + 1;
            end.* = off + 1;
            return true;
        }

        // Check for ordered list item marks
        max_end = @min(off + 9, this.size);
        container.start = 0;
        while (off < max_end and std.ascii.isDigit(this.charAt(off))) {
            container.start = container.start * 10 + (this.charAt(off) - '0');
            off += 1;
        }

        if (off > beg and
            off < this.size and
            (this.isAnyOf2(off, '.', ')')) and
            (off + 1 >= this.size or
            this.isBlank(this.charAt(off + 1) or
            this.isNewline(off + 1))))
        {
            container.ch = this.charAt(off);
            container.is_loose = false;
            container.is_task = false;
            container.mark_indent = indent;
            container.contents_indent = indent + off - beg + 1;
            end.* = off + 1;
            return true;
        }

        return false;
    }

    fn analyzeLine(this: *MDParser, beg: u32, end: *u32, pivot_line: *const Line.Analysis, line: *Line.Analysis) !void {
        _ = this;
        _ = beg;
        _ = end;
        _ = pivot_line;
        _ = line;
        var off = beg;
        var hr_killer: u32 = 0;
        var prev_line_has_list_loosening_effect = this.last_line_has_list_loosening_effect;
        var container = Container{};
        _ = hr_killer;
        _ = prev_line_has_list_loosening_effect;
        _ = container;
        var total_indent: u32 = 0;
        var n_parents: u32 = 0;
        var n_brothers: u32 = 0;
        var n_children: u32 = 0;

        // Given the indentation and block quote marks '>', determine how many of
        // the current containers are our parents.
        while (n_parents < this.containers.len) {
            var c: *Container = this.containers.ptr + n_parents;

            if (c.ch == '>' and line.indent < this.code_indent_offset and off < this.size and this.charAt(off) == '>') {
                off += 1;
                total_indent += 1;
                line.indent = this.getIndent(total_indent, off, &off);
                total_indent += line.indent;

                // The optional 1st space after '>' is part of the block quote mark.
                line.indent -|= line.indent;
                line.beg = off;
            } else if (c.ch != '>' and line.indent >= c.contents_indent) {
                line.indent -|= c.contents_indent;
            } else {
                break;
            }

            n_parents += 1;
        }

        if (off >= this.size or this.isNewline(off)) {
            // Blank line does not need any real indentation to be nested inside a list
            if (n_brothers + n_children == 0) {
                while (n_parents < this.containers.len and this.containers.ptr[n_parents].ch == '>') {
                    n_parents += 1;
                }
            }
        }

        while (true) {
            switch (pivot_line.tag) {
                .fencedcode => {
                    // Check whether we are fenced code continuation.
                    line.beg = off;

                    // We are another MD_LINE_FENCEDCODE unless we are closing fence
                    // which we transform into MD_LINE_BLANK.
                    if (line.indent < this.code_indent_offset) {
                        if (this.isClosingCodeFence(this.charAt(pivot_line.beg), off, &off)) {
                            line.tag = .blank;
                            this.last_line_has_list_loosening_effect = false;
                            break;
                        }
                    }

                    // Change indentation accordingly to the initial code fence.
                    if (n_parents == this.containers.len) {
                        line.indent -|= pivot_line.indent;
                        line.tag = .fenced_code;
                        break;
                    }
                },

                .indentedcode => {},
                .text => {},

                .html => {},
                else => {},
            }

            // Check for blank line.
            if (off >= this.size or this.isNewline(off)) {
                if (pivot_line.tag == .indented_code and n_parents == this.containers.len) {
                    line.tag = .indented_code;
                    line.indent -|= this.code_indent_offset;
                    this.last_line_has_list_loosening_effect = false;
                } else {
                    line.tag = .blank;
                    this.last_line_has_list_loosening_effect = n_parents > 0 and
                        n_brothers + n_children == 0 and
                        this.containers.ptr[n_parents - 1].ch != '>';

                    // See https://github.com/mity/md4c/issues/6
                    //
                    // This ugly checking tests we are in (yet empty) list item but
                    // not its very first line (i.e. not the line with the list
                    // item mark).
                    //
                    // If we are such a blank line, then any following non-blank
                    // line which would be part of the list item actually has to
                    // end the list because according to the specification, "a list
                    // item can begin with at most one blank line."
                    //
                    if (n_parents > 0 and this.containers.ptr[n_parents - 1].ch != '>' and n_brothers + n_children == 0 and this.current_block == null and this.blocks.len > 0) {
                        var top_block = this.blocks.last().?;
                        if (top_block.tag == .li) {
                            this.last_list_item_starts_with_two_blank_lines = true;
                        }
                    }
                }
                break;
            } else {
                // This is the 2nd half of the hack. If the flag is set (i.e. there
                // was a 2nd blank line at the beginning of the list item) and if
                // we would otherwise still belong to the list item, we enforce
                // the end of the list.
                this.last_line_has_list_loosening_effect = false;
                if (this.last_list_item_starts_with_two_blank_lines) {
                    if (n_parents > 0 and
                        this.containers.ptr[n_parents - 1].ch != '>' and
                        n_brothers + n_children == 0 and
                        this.current_block == null and this.blocks.len > 1)
                    {
                        var top = this.blocks.last().?;
                        if (top.tag == .li) {
                            n_parents -|= 1;
                        }
                    }
                    this.last_line_has_list_loosening_effect = true;
                }
            }

            // Check whether we are Setext underline.
            if (line.indent < this.code_indent_offset and
                pivot_line.tag == .text and
                off < this.size and
                this.isAnyOf2(off, '=', '-') and
                n_parents == this.containers.len)
            {
                var level: u4 = 0;
                if (this.isSetextUnderline(off, &off, &level)) {
                    line.tag = .setext_underline;
                    line.data = level;
                    break;
                }
            }

            // Check for a thematic break line
            if (line.indent < this.code_indent_offset and off < this.size and off >= hr_killer and this.isAnyOf(off, "-_*")) {
                if (this.isHRLine(off, &off, &hr_killer)) {
                    line.tag = .hr;
                    break;
                }
            }

            // Check for "brother" container. I.e. whether we are another list item
            //in already started list.
            if (n_parents < this.containers.len and n_brothers + n_children == 0) {
                var tmp: u32 = undefined;

                if (this.isContainerMark(line.indent, off, &tmp, &container) and
                    isContainerCompatible(&this.containers.ptr[n_parents], &container))
                {
                    pivot_line.* = Line.Analysis.blank;
                    off = tmp;

                    total_indent += container.contents_indent - container.mark_indent;
                    line.indent = this.getIndent(total_indent, off, &off);
                    total_indent += line.indent;
                    line.beg = off;

                    //  Some of the following whitespace actually still belongs to the mark.
                    if (off >= this.size or this.isNewline(off)) {
                        container.contents_indent += 1;
                    } else if (line.indent <= this.code_indent_offset) {
                        container.contents_indent += line.indent;
                        line.indent = 0;
                    } else {
                        container.contents_indent += 1;
                        line.indent -= 1;
                    }

                    this.containers.ptr[n_parents].mark_indent = container.mark_indent;
                    this.containers.ptr[n_parents].contents_indent = container.contents_indent;
                    n_brothers += 1;
                    continue;
                }
            }

            // Check for indented code
            // Note: indented code block cannot interrupt a paragrpah
            if (line.indent >= this.code_indent_offset and
                (pivot_line.tag == .blank or
                pivot_line.tag == .indented_code))
            {
                line.tag = .indented_code;
                std.debug.assert(line.indent >= this.code_indent_offset);
                line.indent -|= this.code_indent_offset;
                line.data = 0;
                break;
            }

            // Check for start of a new container block
            if (line.indent < this.code_indent_offset and
                this.isContainerMark(line.indent, off, &off, &container))
            {
                if (pivot_line.tag == .text and
                    n_parents == this.n_containers and
                    (off >= this.size or this.isNewline(off)) and
                    container.ch != '>')
                {
                    // Noop. List mark followed by a blank line cannot interrupt a paragraph.
                } else if (pivot_line.tag == .text and
                    n_parents == this.containers.len and
                    isAnyOf2_(container.ch, '.', ')'))
                {
                    // Noop. Ordered list cannot interrupt a paragraph unless the start index is 1.
                } else {
                    total_indent += container.contents_indent - container.mark_indent;
                    line.indent = this.getIndent(total_indent, off, &off);
                    total_indent += line.indent;

                    line.beg = off;
                    line.data = container.ch;

                    // Some of the following whitespace actually still belongs to the mark.
                    if (off >= this.size or this.isNewline(off)) {
                        container.contents_indent += 1;
                    } else if (line.indent <= this.code_indent_offset) {
                        container.contents_indent += line.indent;
                        line.indent = 0;
                    } else {
                        container.contents_indent += 1;
                        line.indent -= 1;
                    }

                    if (n_brothers + n_children == 0) {
                        pivot_line.* = Line.Analysis.blank;
                    }

                    if (n_children == 0) {
                        try this.leaveChildContainers(n_parents + n_brothers);
                    }

                    n_children += 1;
                    try this.pushContainer(container);
                    continue;
                }
            }

            // heck whether we are table continuation.
            if (pivot_line.tag == .table and n_parents == this.n_containers) {
                line.tag = .table;
                break;
            }

            // heck for ATX header.
            if (line.indent < this.code_indent_offset and off < this.size and this.isAnyOf(off, '#')) {
                var level: u4 = 0;
                if (this.isATXHeaderLine(off, &line.beg, &off, &level)) {
                    line.tag = .atx_header;
                    line.data = level;
                    break;
                }
            }

            // Check whether we are starting code fence.
            if (off < this.size and this.isAnyOf2(off, '`', '~')) {
                if (this.isOpeningCodeFence(off, &off)) {
                    line.tag = .fenced_code;
                    line.data = 1;
                    break;
                }
            }

            // Check for start of raw HTML block.
            if (off < this.size and !this.flags.contains(.no_html_blocks) and this.charAt(off) == '<') {}

            // Check for table underline.
            if (this.flags.contains(.tables) and pivot_line.tag == .text and off < this.size and this.isAnyOf(off, "|-:") and n_parents == this.containers.len) {
                var col_count: u32 = undefined;

                if (this.current_block != null and this.current_block.?.line_count == 1 and this.isTableUnderline(off, &off, &col_count)) {
                    line.data = col_count;
                    line.tag = .table_underline;
                    break;
                }
            }

            //  By default, we are normal text line.
            line.tag = .text;
            if (pivot_line.tag == .text and n_brothers + n_children == 0) {
                // lazy continuation
                n_parents = this.containers.len;
            }

            // Check for task mark.
            if (this.flags.contains(.tasklists) and
                n_brothers + n_children > 0 and
                off < this.size and
                isCharAnyOf(this.containers.last().?.ch, "-+*.)"))
            {
                var tmp: u32 = off;

                while (tmp < this.size and tmp < off + 3 and isBlank(tmp)) {
                    tmp += 1;
                }

                if ((tmp + 2 < this.size and
                    this.charAt(tmp) == '[' and
                    this.isAnyOf(tmp + 1, "xX ") and
                    this.charAt(tmp + 2) == ']') and
                    (tmp + 3 == this.size or
                    isBlank(this.charAt(tmp + 3)) or
                    this.isNewline(tmp + 3)))
                {
                    var task_container: *Container = if (n_children > 0) this.containers.last().? else &container;
                    task_container.is_task = true;
                    task_container.task_mark_off = tmp + 1;
                    off = tmp + 3;
                    while (off < this.size and isWhitespace(this.charAt(off))) {
                        off += 1;
                    }
                    if (off == this.size) break;
                    line.beg = off;
                }
            }

            break;
        }

        // Scan for end of the line.
        while (!(strings.hasPrefixComptime(this.source.contents.ptr[off..], "\n\n\n\n") or
            strings.hasPrefixComptime(this.source.contents.ptr[off..], "\r\n\r\n")))
        {
            off += 4;
        }

        while (off < this.size and !this.isNewline(off)) {
            off += 1;
        }

        // Set end of line
        line.end = off;

        // ut for ATX header, we should exclude the optional trailing mark.
        if (line.type == .atx_header) {
            var tmp = line.end;
            while (tmp > line.beg and this.charAt(tmp - 1) == ' ') {
                tmp -= 1;
            }

            while (tmp > line.beg and this.charAt(tmp - 1) == '#') {
                tmp -= 1;
            }

            if (tmp == line.beg or this.charAt(tmp - 1) == ' ' or this.flags.contains(.permissive_atxheaders)) {
                line.end = tmp;
            }
        }

        // Trim trailing spaces.
        switch (line.tag) {
            .indented_code, .fenced_code => {},
            else => {
                while (line.end > line.beg and this.charAt(line.end - 1) == ' ') {
                    line.end -= 1;
                }
            },
        }

        // Eat also the new line
        if (off < this.size and this.charAt(off) == '\r') {
            off += 1;
        }

        if (off < this.size and this.charAt(off) == '\n') {
            off += 1;
        }

        end.* = off;

        // If we belong to a list after seeing a blank line, the list is loose.
        if (prev_line_has_list_loosening_effect and line.tag != .blank and n_parents + n_brothers > 0) {
            var c: *Container = this.containers.ptr[n_parents + n_brothers - 1];
            if (c.ch != '>') {
                var block: *Block = this.blocks.ptr[c.block_index];
                block.flags.insert(.loose_list);
            }
        }

        // Leave any containers we are not part of anymore.
        if (n_children == 0 and n_parents + n_brothers < this.containers.len) {
            try this.leaveChildContainers(n_parents + n_brothers);
        }

        // Enter any container we found a mark for
        if (n_brothers > 0) {
            std.debug.assert(n_brothers == 0);
            try this.pushContainerBytes(
                Block.Tag.li,
                this.containers.ptr[n_parents].task_mark_off,
                if (this.containers.ptr[n_parents].is_task) this.charAt(this.containers.ptr[n_parents].task_mark_off) else 0,
                Block.Flags.container_closer,
            );
            try this.pushContainerBytes(
                Block.Tag.li,
                container.task_mark_off,
                if (container.is_task) this.charAt(container.task_mark_off) else 0,
                Block.Flags.container_opener,
            );
            this.containers.ptr[n_parents].is_task = container.is_task;
            this.containers.ptr[n_parents].task_mark_off = container.task_mark_off;
        }

        if (n_children > 0) {
            try this.enterChildContainers(n_children);
        }
    }
    fn processLine(this: *MDParser, p_pivot_line: **const Line.Analysis, line: *Line.Analysis) !void {
        var pivot_line = p_pivot_line.*;

        switch (line.tag) {
            .blank => {
                // Blank line ends current leaf block.
                try this.endCurrentBlock();
                p_pivot_line.* = Line.Analysis.blank;
            },
            .hr, .atx_header => {
                try this.endCurrentBlock();

                // Add our single-line block
                try this.startNewBlock(line);
                try this.addLineIntoCurrentBlock(line);
                try this.endCurrentBlock();
                p_pivot_line.* = &Line.Analysis.blank;
            },
            .setext_underline => {
                this.current_block.?.tag = .table;
                this.current_block.?.data = line.data;
                this.current_block.?.flags.insert(.setext_header);
                try this.addLineIntoCurrentBlock(line);
                try this.endCurrentBlock();
                if (this.current_block == null) {
                    p_pivot_line.* = &Line.Analysis.blank;
                } else {
                    // This happens if we have consumed all the body as link ref. defs.
                    //and downgraded the underline into start of a new paragraph block.
                    line.tag = .text;
                    p_pivot_line.* = line;
                }
            },
            // MD_LINE_TABLEUNDERLINE changes meaning of the current block.
            .table_underline => {
                var current_block = this.current_block.?;
                std.debug.assert(current_block.line_count == 1);
                current_block.tag = .table;
                current_block.data = line.data;
                std.debug.assert(pivot_line != &Line.Analysis.blank);
                @intToPtr(*Line.Analysis, @ptrToInt(p_pivot_line.*)).tag = .table;
                try this.addLineIntoCurrentBlock(line);
            },
            else => {
                // The current block also ends if the line has different type.
                if (line.tag != pivot_line.tag) {
                    try this.endCurrentBlock();
                }

                // The current line may start a new block.
                if (this.current_block == null) {
                    try this.startNewBlock(line);
                    p_pivot_line.* = line;
                }

                // In all other cases the line is just a continuation of the current block.
                try this.addLineIntoCurrentBlock(line);
            },
        }
    }
    fn consumeLinkReferenceDefinitions(this: *MDParser) !void {
        _ = this;
    }
    fn addLineIntoCurrentBlock(this: *MDParser, analysis: *const Line.Analysis) !void {
        var current_block = this.current_block.?;

        switch (current_block.tag) {
            .code, .html => {
                if (current_block.line_count > 0)
                    std.debug.assert(
                        this.verbatim_lines.len == current_block.line_count + current_block.line_offset,
                    );
                if (current_block.line_count == 0) {
                    current_block.line_offset = this.verbatim_lines.len;
                }

                try this.verbatim_lines.push(this.allocator, Line.Verbatim{
                    .indent = analysis.indent,
                    .line = .{
                        .beg = analysis.beg,
                        .end = analysis.end,
                    },
                });
            },
            else => {
                if (current_block.line_count > 0)
                    std.debug.assert(
                        this.lines.len == current_block.line_count + current_block.line_offset,
                    );
                if (current_block.line_count == 0) {
                    current_block.line_offset = this.lines.len;
                }
                this.lines.push(this.allocator, .{ .beg = analysis.beg, .end = analysis.end });
            },
        }

        current_block.line_count += 1;
    }
    fn endCurrentBlock(this: *MDParser) !void {
        _ = this;

        var block = this.current_block orelse return;
        // Check whether there is a reference definition. (We do this here instead
        // of in md_analyze_line() because reference definition can take multiple
        // lines.) */
        if ((block.tag == .p or block.tag == .h) and block.flags.contains(.setext_header)) {
            var lines = block.lines(this.lines);
            if (lines[0].beg == '[') {
                try this.consumeLinkReferenceDefinitions();
                block = this.current_block orelse return;
            }
        }

        if (block.tag == .h and block.flags.contains(.setext_header)) {
            var n_lines = block.line_count;
            if (n_lines > 1) {
                // get rid of the underline
                if (this.lines.len == block.line_count + block.line_offset) {
                    this.lines.len -= 1;
                }
                block.line_count -= 1;
            } else {
                // Only the underline has left after eating the ref. defs.
                // Keep the line as beginning of a new ordinary paragraph. */
                block.tag = .p;
            }
        }

        // Mark we are not building any block anymore.
        this.current_block = null;
        this.current_block_index -|= 1;
    }
    fn buildRefDefHashTable(this: *MDParser) !void {
        _ = this;
    }
    fn leaveChildContainers(this: *MDParser, keep: u32) !void {
        _ = this;
        while (this.containers.len > keep) {
            var c = this.containers.last().?;
            var is_ordered_list = false;
            switch (c.ch) {
                ')', '.' => {
                    is_ordered_list = true;
                },
                '-', '+', '*' => {
                    try this.pushContainerBytes(
                        Block.Tag.li,
                        c.task_mark_off,
                        if (c.is_task) this.charAt(c.task_mark_off) else 0,
                        Block.Flags.container_closer,
                    );
                    try this.pushContainerBytes(
                        if (is_ordered_list) Block.Tag.ol else Block.Tag.ul,
                        c.ch,
                        if (c.is_task) this.charAt(c.task_mark_off) else 0,
                        Block.Flags.container_closer,
                    );
                },
                '>' => {
                    try this.pushContainerBytes(
                        Block.Tag.quote,
                        0,
                        0,
                        Block.Flags.container_closer,
                    );
                },
                else => unreachable,
            }

            this.containers.len -= 1;
        }
    }
    fn enterChildContainers(this: *MDParser, keep: u32) !void {
        _ = this;
        var i: u32 = this.containers.len - keep;
        while (i < this.containers.len) : (i += 1) {
            var c: *Container = this.containers.ptr[i];
            var is_ordered_list = false;

            switch (c.ch) {
                ')', '.' => {
                    is_ordered_list = true;
                },
                '-', '+', '*' => {
                    //  Remember offset in ctx.block_bytes so we can revisit the
                    // block if we detect it is a loose list.
                    try this.endCurrentBlock();
                    c.block_index = this.blocks.len;

                    try this.pushContainerBytes(
                        if (is_ordered_list) Block.Tag.ol else Block.Tag.ul,
                        c.start,
                        c.ch,
                        Block.Flags.container_opener,
                    );
                    try this.pushContainerBytes(
                        Block.Tag.li,
                        c.task_mark_off,
                        if (c.is_task) this.charAt(c.task_mark_off) else 0,
                        Block.Flags.container_opener,
                    );
                },
                '>' => {
                    try this.pushContainerBytes(
                        Block.Tag.quote,
                        0,
                        0,
                        Block.Flags.container_opener,
                    );
                },
                else => unreachable,
            }
        }
    }
    fn pushContainer(this: *MDParser, container: Container) !void {
        try this.containers.push(this.allocator, container);
    }

    fn processLeafBlock(this: *MDParser, comptime tag: Block.Tag, block: *Block) anyerror!void {
        const BlockDetailType = comptime switch (tag) {
            Block.Tag.h => Block.Header,
            Block.Tag.code => Block.Code,
            Block.Tag.table => Block.Table,
        };

        const is_in_tight_list = if (this.containers.len == 0)
            false
        else
            !this.containers.ptr[this.containers.len - 1].is_loose;

        const detail: BlockDetailType = switch (comptime tag) {
            Block.Tag.h => @truncate(Block.Header, block.data),
            Block.Tag.code => try this.setupFencedCodeDetail(block),
            Block.Tag.table => .{
                .col_count = block.data,
                .head_row_count = 1,
                .body_row_count = block.line_count -| 2,
            },
            else => {},
        };

        if (!is_in_tight_list or comptime tag != .p) {
            try this.mdx.onEnterBlock(block.tag, BlockDetailType, detail);
        }

        defer {
            if (comptime tag == Block.Tag.code) {}
        }
    }

    fn pushContainerBytes(this: *MDParser, block_type: Block.Tag, start: u32, data: u32, flag: Block.Flags) !void {
        try this.endCurrentBlock();
        var block = Block{
            .tag = block_type,
            .line_count = start,
            .data = data,
        };
        block.flags.insert(flag);
        var prev_block: ?Block = null;
        if (this.current_block) |curr| {
            prev_block = curr.*;
        }

        try this.blocks.push(this.allocator, block);
        if (prev_block != null) {
            this.current_block = this.blocks.ptr[this.current_block_index];
        }
    }
    fn processBlock(this: *MDParser, comptime tag: Block.Tag, block: *Block) !void {
        const detail: Block.Detail =
            switch (comptime tag) {
            .ul => Block.Detail{
                .ul = .{
                    .is_tight = !block.flags.contains(.loose_list),
                    .mark = @truncate(u8, block.data),
                },
            },
            .ol => Block.Detail{
                .ol = .{
                    .start = block.line_count,
                    .is_tight = !block.flags.contains(.loose_list),
                    .mark_delimiter = @truncate(u8, block.data),
                },
            },
            .li => Block.Detail{
                .li = .{
                    .is_task = block.data != 0,
                    .task_mark = @truncate(u8, block.data),
                    .task_mark_offset = @intCast(u32, block.line_count),
                },
            },
            else => Block.Detail{ .none = .{} },
        };

        if (block.flags.contains(.container)) {
            if (block.flags.contains(.container_closer)) {
                switch (block.tag) {
                    .li => try this.mdx.onLeaveBlock(tag, Block.LI, detail.li),
                    .ul => try this.mdx.onLeaveBlock(tag, Block.UL, detail.ul),
                    .ol => try this.mdx.onLeaveBlock(tag, Block.OL, detail.ol),
                    else => try this.mdx.onLeaveBlock(block.tag, void, {}),
                }
                this.containers.len -|= switch (block.tag) {
                    .ul, .ol, .blockquote => 1,
                    else => 0,
                };
            }

            if (block.flags.contains(.container_opener)) {
                switch (comptime tag) {
                    .li => try this.mdx.onEnterBlock(tag, Block.LI, detail.li),
                    .ul => try this.mdx.onEnterBlock(tag, Block.UL, detail.ul),
                    .ol => try this.mdx.onEnterBlock(tag, Block.OL, detail.ol),
                    else => try this.mdx.onEnterBlock(block.tag, void, {}),
                }

                switch (comptime tag) {
                    .ul, .ol => {
                        this.containers.ptr[this.containers.len].is_loose = block.flags.contains(.loose_list);
                        this.containers.len += 1;
                    },
                    .blockquote => {
                        //  This causes that any text in a block quote, even if
                        // nested inside a tight list item, is wrapped with
                        // <p>...</p>. */
                        this.containers.ptr[this.containers.len].is_loose = true;
                        this.containers.len += 1;
                    },
                    else => {},
                }
            }
        } else {
            try this.processLeafBlock(tag, block);
        }
    }
    fn processAllBlocks(this: *MDParser) !void {
        _ = this;

        // ctx->containers now is not needed for detection of lists and list items
        // so we reuse it for tracking what lists are loose or tight. We rely
        // on the fact the vector is large enough to hold the deepest nesting
        // level of lists.
        this.containers.len = 0;
        var blocks = this.blocks.slice();
        for (&blocks) |*block| {}
    }
    fn isContainerCompatible(pivot: *const Container, container: *const Container) bool {
        // Block quote has no "items" like lists.
        if (container.ch == '>') return false;

        if (container.ch != pivot.ch)
            return false;

        if (container.mark_indent > pivot.contents_indent)
            return false;
        return true;
    }

    fn isHRLine(this: *MDParser, beg: u32, end: *u32, hr_killer: *u32) bool {
        var off = beg + 1;
        var n: u32 = 1;

        while (off < this.size and (this.charAt(off) == this.charAt(beg) or this.charAt(off) == ' ' or this.charAt(off) == '\t')) {
            if (this.charAt(off) == this.charAt(beg))
                n += 1;
            off += 1;
        }

        if (n < 3) {
            hr_killer.* = off;
            return false;
        }

        // Nothing else can be present on the line. */
        if (off < this.size and !this.isNewline(off)) {
            hr_killer.* = off;
            return false;
        }

        end.* = off;
        return true;
    }

    fn isSetextUnderline(this: *MDParser, beg: u32, end: *u32, level: *u4) bool {
        var off = beg + 1;
        while (off < this.size and this.charAt(off) == this.charAt(beg))
            off += 1;

        // Optionally, space(s) can follow. */
        while (off < this.size and this.charAt(off) == ' ')
            off += 1;

        // But nothing more is allowed on the line.
        if (off < this.size and !this.isNewline(off))
            return false;
        level.* = if (this.charAt(beg) == '=') 1 else 2;
        end.* = off;
        return true;
    }

    fn isATXHeaderLine(this: *MDParser, beg: u32, p_beg: *u32, end: *u32, level: *u4) bool {
        var n: i32 = undefined;
        var off: u32 = beg + 1;

        while (off < this.size and this.charAt(off) == '#' and off - beg < 7) {
            off += 1;
        }
        n = off - beg;

        if (n > 6)
            return false;
        level.* = @intCast(u4, n);

        if (!(this.flags.contains(.permissive_atxheaders)) and off < this.size and
            this.charAt(off) != ' ' and this.charAt(off) != '\t' and !this.isNewline(off))
            return false;

        while (off < this.size and this.charAt(off) == ' ') {
            off += 1;
        }

        p_beg.* = off;
        end.* = off;

        return true;
    }

    fn isTableUnderline(this: *MDParser, beg: u32, end: *u32, column_column: *u32) bool {
        _ = this;
        _ = end;
        _ = column_column;

        var off = beg;
        var found_pipe = false;
        var col_count: u32 = 0;

        if (off < this.size and this.charAt(off) == '|') {
            found_pipe = true;
            off += 1;
            while (off < this.size and isWhitespace(this.charAt(off))) {
                off += 1;
            }
        }

        while (true) {
            var delimited = false;

            // Cell underline ("-----", ":----", "----:" or ":----:")if(off < this.size  and  this.charAt(off) == _T(':'))
            off += 1;
            if (off >= this.size or this.charAt(off) != '-')
                return false;
            while (off < this.size and this.charAt(off) == '-')
                off += 1;
            if (off < this.size and this.charAt(off) == ':')
                off += 1;

            col_count += 1;

            // Pipe delimiter (optional at the end of line). */
            while (off < this.size and isWhitespace(this.charAt(off)))
                off += 1;
            if (off < this.size and this.charAt(off) == '|') {
                delimited = true;
                found_pipe = true;
                off += 1;
                while (off < this.size and isWhitespace(this.charAt(off)))
                    off += 1;
            }

            // Success, if we reach end of line.
            if (off >= this.size or this.isNewline(off))
                break;

            if (!delimited)
                return false;
        }

        if (!found_pipe)
            return false;

        column_column.* = col_count;
        end.* = off;
        return true;
    }

    fn isOpeningCodeFence(this: *MDParser, beg: u8, end: *u32) bool {
        var off = beg;
        const first = this.charAt(beg);

        while (off < this.size and this.charAt(off) == first) {
            off += 1;
        }

        // Fence must have at least three characters.
        if (off - beg < 3)
            return false;

        // Optionally, space(s) can follow
        while (off < this.size and this.charAt(off) == ' ') {
            off += 1;
        }

        // Optionally, an info string can follow.
        while (off < this.size and !this.isNewline(this.charAt(off))) {
            // Backtick-based fence must not contain '`' in the info string.
            if (first == '`' and this.charAt(off) == '`')
                return false;
            off += 1;
        }

        end.* = off;
        return true;
    }

    fn isClosingCodeFence(this: *MDParser, ch: u8, beg: u8, end: *u32) bool {
        var off = beg;

        defer {
            end.* = off;
        }

        while (off < this.size and this.charAt(off) == ch) {
            off += 1;
        }

        if (off - beg < this.code_fence_length) {
            return false;
        }

        // Optionally, space(s) can follow
        while (off < this.size and this.charAt(off) == ' ') {
            off += 1;
        }

        // But nothing more is allowed on the line.
        if (off < this.size and !this.isNewline(this.charAt(off)))
            return false;

        return true;
    }

    pub fn parse(this: *MDParser) anyerror!void {
        var pivot_line = &Line.Analysis.blank;
        var line_buf: [2]Line.Analysis = undefined;
        var line = &line_buf[0];
        var offset: u32 = 0;

        try this.mdx.onEnterBlock(.doc, void, {});

        const len: u32 = this.size;
        while (offset < len) {
            if (line == pivot_line) {
                line = if (line == &line_buf[0]) &line_buf[1] else &line_buf[0];
            }

            try this.analyzeLine(offset, &offset, pivot_line, line);
            try this.processLine(&pivot_line, line);
        }

        this.endCurrentBlock();

        try this.buildRefDefHashTable();

        this.leaveChildContainers(0);
        this.processAllBlocks();
        try this.mdx.onLeaveBlock(.doc, void, {});
    }
};

pub const MDX = struct {
    parser: JSParser,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    stmts: std.ArrayListUnmanaged(js_ast.Stmt) = .{},

    pub const Options = struct {};

    pub fn onEnterBlock(this: *MDX, tag: Block.Tag, comptime Detail: type, detail: Detail) anyerror!void {
        _ = tag;
        _ = detail;
        _ = this;
    }

    pub fn onLeaveBlock(this: *MDX, tag: Block.Tag, comptime Detail: type, detail: Detail) anyerror!void {
        _ = tag;
        _ = detail;
        _ = this;
    }

    pub fn onEnterSpan(this: *MDX, tag: Span.Tag, comptime Detail: type, detail: Detail) anyerror!void {
        _ = tag;
        _ = detail;
        _ = this;
    }

    pub fn onLeaveSpan(this: *MDX, tag: Span.Tag, comptime Detail: type, detail: Detail) anyerror!void {
        _ = tag;
        _ = detail;
        _ = this;
    }

    pub fn onText(this: *MDX, tag: Text, text: []const u8) anyerror!void {
        _ = tag;
        _ = text;
        _ = this;
    }

    pub inline fn source(p: *const MDX) *const logger.Source {
        return &p.lexer.source;
    }

    pub fn e(_: *MDX, t: anytype, loc: logger.Loc) Expr {
        const Type = @TypeOf(t);
        if (@typeInfo(Type) == .Pointer) {
            return Expr.init(std.meta.Child(Type), t.*, loc);
        } else {
            return Expr.init(Type, t, loc);
        }
    }

    pub fn s(_: *MDX, t: anytype, loc: logger.Loc) Stmt {
        const Type = @TypeOf(t);
        if (@typeInfo(Type) == .Pointer) {
            return Stmt.init(std.meta.Child(Type), t.*, loc);
        } else {
            return Stmt.alloc(Type, t, loc);
        }
    }

    pub fn setup(
        this: *MDX,
        _options: ParserOptions,
        log: *logger.Log,
        source_: *const logger.Source,
        define: *Define,
        allocator: std.mem.Allocator,
    ) !void {
        try JSParser.init(
            allocator,
            log,
            source_,
            define,
            js_lexer.Lexer.initNoAutoStep(log, source_.*, allocator),
            _options,
            &this.parser,
        );
        this.lexer = try Lexer.init(&this.parser.lexer);
        this.allocator = allocator;
        this.log = log;
        this.stmts = .{};
    }

    pub fn parse(this: *MDX) !js_ast.Result {
        try this._parse();
        return try runVisitPassAndFinish(JSParser, &this.parser, try this.stmts.toOwnedSlice(this.allocator));
    }

    fn run(this: *MDX) anyerror!logger.Loc {
        _ = this;
        return logger.Loc.Empty;
    }

    fn _parse(this: *MDX) anyerror!void {
        var root_children = std.ArrayListUnmanaged(Expr){};
        var first_loc = try run(this, &root_children);

        first_loc.start = @max(first_loc.start, 0);
        const args_loc = first_loc;
        first_loc.start += 1;
        const body_loc = first_loc;

        // We need to simulate a function that was parsed
        _ = try this.parser.pushScopeForParsePass(.function_args, args_loc);

        _ = try this.parser.pushScopeForParsePass(.function_body, body_loc);

        const root = this.e(E.JSXElement{
            .tag = this.e(E.JSXElement.Tag.map.get(E.JSXElement.Tag.main), body_loc),
            .children = ExprNodeList.fromList(root_children),
        }, body_loc);

        var root_stmts = try this.allocator.alloc(Stmt, 1);
        root_stmts[0] = this.s(S.Return{ .value = root }, body_loc);

        try this.stmts.append(
            this.allocator,

            this.s(S.ExportDefault{
                .default_name = try this.parser.createDefaultName(args_loc),
                .value = .{
                    .expr = this.e(E.Arrow{
                        .body = G.FnBody{
                            .stmts = root_stmts,
                            .loc = body_loc,
                        },
                        .args = &[_]G.Arg{},
                        .prefer_expr = true,
                    }, args_loc),
                },
            }, args_loc),
        );
    }
};
