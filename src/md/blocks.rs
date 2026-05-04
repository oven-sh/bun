use crate::autolinks::is_list_item_mark;
use crate::helpers;
use crate::parser::{self, Parser};
use crate::types::{self, BlockType, Container, Line, VerbatimLine, OFF};

use core::mem::{align_of, size_of};

type BlockHeader = parser::BlockHeader;

impl Parser {
    pub fn process_doc(&mut self) -> Result<(), parser::Error> {
        let dummy_blank = Line { r#type: LineType::Blank, ..Line::default() };
        let mut pivot_line = dummy_blank;
        let mut line_buf: [Line; 2] = [Line::default(), Line::default()];
        let mut line_idx: usize = 0;
        let mut off: OFF = 0;

        self.enter_block(BlockType::Doc, 0, 0)?;

        while off < self.size {
            // PORT NOTE: reshaped for borrowck — index into line_buf via raw idx
            let line = &mut line_buf[line_idx];

            self.analyze_line(off, &mut off, &pivot_line, line)?;
            // PORT NOTE: reshaped for borrowck — pass whole buf + idx so process_line can swap
            self.process_line(&mut pivot_line, line_idx, &mut line_buf, &mut line_idx)?;
        }

        self.end_current_block()?;

        // Build ref def hashtable
        self.build_ref_def_hashtable()?;

        // Process all blocks
        self.leave_child_containers(0)?;
        self.process_all_blocks()?;

        self.leave_block(BlockType::Doc, 0)?;
        Ok(())
    }

    pub fn analyze_line(
        &mut self,
        off_start: OFF,
        p_end: &mut OFF,
        pivot_line: &Line,
        line: &mut Line,
    ) -> Result<(), bun_alloc::AllocError> {
        let mut off = off_start;
        let mut total_indent: u32 = 0;
        let mut n_parents: u32 = 0;
        let mut n_brothers: u32 = 0;
        let mut n_children: u32 = 0;
        let mut container = Container::default();
        let prev_line_has_list_loosening_effect = self.last_line_has_list_loosening_effect;

        *line = Line::default();
        line.enforce_new_block = false;

        // Eat indentation and match containers
        let indent_result = helpers::line_indentation(self.text, total_indent, off);
        line.indent = indent_result.indent;
        total_indent += line.indent;
        off = indent_result.off;
        line.beg = off;

        // Match existing containers
        // remaining_indent tracks the indent left after subtracting each matched
        // container's contents_indent. This ensures nested containers compare
        // against the correct relative indentation rather than the absolute column.
        let mut remaining_indent = total_indent;
        while n_parents < self.n_containers {
            let c = &self.containers[n_parents as usize];
            if c.ch == b'>' {
                // Blockquote continuation
                if off < self.size
                    && self.text[off as usize] == b'>'
                    && line.indent < self.code_indent_offset
                {
                    off += 1;
                    total_indent += 1;
                    let r = helpers::line_indentation(self.text, total_indent, off);
                    line.indent = r.indent;
                    total_indent += line.indent;
                    off = r.off;
                    // The optional 1st space after '>' is part of the blockquote mark
                    if line.indent > 0 {
                        line.indent -= 1;
                    }
                    // Use local indent (after optional-space adjustment) for subsequent
                    // list container matching, matching md4c's use of line->indent.
                    remaining_indent = line.indent;
                    line.beg = off;
                    n_parents += 1;
                    continue;
                } else {
                    break;
                }
            } else {
                // List continuation - check indentation against remaining indent
                if remaining_indent >= c.contents_indent {
                    remaining_indent -= c.contents_indent;
                    line.indent = remaining_indent;
                    n_parents += 1;
                    continue;
                } else {
                    break;
                }
            }
        }

        self.last_line_has_list_loosening_effect = false;

        // Blank line lazy-matches list containers BEFORE the main detection loop
        // (md4c does this outside while(TRUE) to ensure n_parents is correct for
        // fenced code and HTML block container-boundary checks)
        if off >= self.size || helpers::is_newline(self.text[off as usize]) {
            if n_brothers + n_children == 0 {
                while n_parents < self.n_containers
                    && self.containers[n_parents as usize].ch != b'>'
                {
                    n_parents += 1;
                }
            }
        }

        // Track effective pivot type — brother/child containers reset this to .blank
        let mut effective_pivot_type = pivot_line.r#type;

        // Determine line type
        loop {
            // Check for fenced code continuation/closing (BEFORE blank line check, like md4c)
            if effective_pivot_type == LineType::FencedCode {
                line.beg = off;

                // Check for closing fence
                if line.indent < self.code_indent_offset {
                    if self.is_closing_code_fence(off, pivot_line.data) {
                        line.r#type = LineType::Blank; // ending fence treated as blank
                        self.last_line_has_list_loosening_effect = false;
                        break;
                    }
                }

                // Fenced code continuation only if all containers matched (md4c: n_parents == n_containers)
                if n_parents == self.n_containers {
                    if line.indent > self.fence_indent {
                        line.indent -= self.fence_indent;
                    } else {
                        line.indent = 0;
                    }
                    line.r#type = LineType::FencedCode;
                    break;
                }
                // If containers don't match, fenced code is implicitly ended.
                // Fall through to other checks.
            }

            // Check for HTML block continuation (BEFORE blank line check, like md4c)
            if effective_pivot_type == LineType::Html && self.html_block_type > 0 {
                if n_parents < self.n_containers {
                    // HTML block is implicitly ended when enclosing container closes
                    self.html_block_type = 0;
                } else {
                    if self.is_html_block_end_condition(off, self.html_block_type) {
                        // Save type before clearing (md4c uses a local variable)
                        let ended_type = self.html_block_type;
                        self.html_block_type = 0;

                        // Types 6 and 7 end conditions also serve as blank lines
                        if ended_type == 6 || ended_type == 7 {
                            line.r#type = LineType::Blank;
                            line.indent = 0;
                            break;
                        }
                    }
                    line.r#type = LineType::Html;
                    n_parents = self.n_containers;
                    break;
                }
            }

            // Check for blank line
            if off >= self.size || helpers::is_newline(self.text[off as usize]) {
                // Indented code continuation through blank lines
                if effective_pivot_type == LineType::IndentedCode && n_parents == self.n_containers {
                    line.r#type = LineType::IndentedCode;
                    if line.indent > self.code_indent_offset {
                        line.indent -= self.code_indent_offset;
                    } else {
                        line.indent = 0;
                    }
                    self.last_line_has_list_loosening_effect = false;
                } else {
                    line.r#type = LineType::Blank;
                    self.last_line_has_list_loosening_effect = n_parents > 0
                        && n_brothers + n_children == 0
                        && self.containers[(n_parents - 1) as usize].ch != b'>';

                    // HTML block types 6 and 7 end on a blank line
                    if self.html_block_type >= 6 {
                        self.html_block_type = 0;
                    }

                    // md4c issue #6: Track empty list items that start with 2+ blank lines.
                    // A list item can begin with at most one blank line.
                    if n_parents > 0
                        && self.containers[(n_parents - 1) as usize].ch != b'>'
                        && n_brothers + n_children == 0
                        && self.current_block.is_none()
                        && self.block_bytes.len() > size_of::<BlockHeader>()
                    {
                        let align_mask_: usize = align_of::<BlockHeader>() - 1;
                        let top_off = (self.block_bytes.len() - size_of::<BlockHeader>()
                            + align_mask_)
                            & !align_mask_;
                        if top_off + size_of::<BlockHeader>() <= self.block_bytes.len() {
                            // SAFETY: block_bytes stores BlockHeader-aligned records; top_off computed above
                            let top_hdr: &BlockHeader = unsafe {
                                &*(self
                                    .block_bytes
                                    .as_ptr()
                                    .add(self.block_bytes.len() - size_of::<BlockHeader>())
                                    .cast::<BlockHeader>())
                            };
                            if top_hdr.block_type == BlockType::Li {
                                self.last_list_item_starts_with_two_blank_lines = true;
                            }
                        }
                    }
                }
                break;
            } else {
                // Non-blank line: check if we need to force-close an empty list item
                // (second half of md4c issue #6 hack)
                if self.last_list_item_starts_with_two_blank_lines {
                    if n_parents > 0
                        && n_parents == self.n_containers
                        && self.containers[(n_parents - 1) as usize].ch != b'>'
                        && n_brothers + n_children == 0
                        && self.current_block.is_none()
                        && self.block_bytes.len() > size_of::<BlockHeader>()
                    {
                        // SAFETY: block_bytes stores BlockHeader-aligned records at len - sizeof
                        let top_hdr: &BlockHeader = unsafe {
                            &*(self
                                .block_bytes
                                .as_ptr()
                                .add(self.block_bytes.len() - size_of::<BlockHeader>())
                                .cast::<BlockHeader>())
                        };
                        if top_hdr.block_type == BlockType::Li {
                            n_parents -= 1;
                            line.indent = total_indent;
                            if n_parents > 0 {
                                line.indent -= line
                                    .indent
                                    .min(self.containers[(n_parents - 1) as usize].contents_indent);
                            }
                        }
                    }
                    self.last_list_item_starts_with_two_blank_lines = false;
                }
                self.last_line_has_list_loosening_effect = false;
            }

            // Indented code continuation
            if effective_pivot_type == LineType::IndentedCode {
                if line.indent >= self.code_indent_offset {
                    line.r#type = LineType::IndentedCode;
                    line.indent -= self.code_indent_offset;
                    line.data = 0;
                    break;
                }
            }

            // Check for Setext underline
            if line.indent < self.code_indent_offset
                && effective_pivot_type == LineType::Text
                && off < self.size
                && (self.text[off as usize] == b'=' || self.text[off as usize] == b'-')
                && n_parents == self.n_containers
            {
                let setext_result = self.is_setext_underline(off);
                if setext_result.is_setext {
                    line.r#type = LineType::SetextUnderline;
                    line.data = setext_result.level;
                    break;
                }
            }

            // Check for thematic break
            if line.indent < self.code_indent_offset
                && off < self.size
                && (self.text[off as usize] == b'-'
                    || self.text[off as usize] == b'_'
                    || self.text[off as usize] == b'*')
            {
                if self.is_hr_line(off) {
                    line.r#type = LineType::Hr;
                    break;
                }
            }

            // Check for brother container (another list item in same list)
            if n_parents < self.n_containers && n_brothers + n_children == 0 {
                let cont_result = self.is_container_mark(line.indent, off);
                if cont_result.is_container {
                    if self.is_container_compatible(
                        &self.containers[n_parents as usize],
                        &cont_result.container,
                    ) {
                        effective_pivot_type = LineType::Blank;

                        container = cont_result.container;
                        off = cont_result.off;

                        total_indent += container.contents_indent - container.mark_indent;
                        let r = helpers::line_indentation(self.text, total_indent, off);
                        line.indent = r.indent;
                        total_indent += line.indent;
                        off = r.off;
                        line.beg = off;

                        // Adjust whitespace belonging to mark
                        if off >= self.size || helpers::is_newline(self.text[off as usize]) {
                            container.contents_indent += 1;
                        } else if line.indent <= self.code_indent_offset {
                            container.contents_indent += line.indent;
                            line.indent = 0;
                        } else {
                            container.contents_indent += 1;
                            line.indent -= 1;
                        }

                        self.containers[n_parents as usize].mark_indent = container.mark_indent;
                        self.containers[n_parents as usize].contents_indent =
                            container.contents_indent;

                        // HTML block ends when a new sibling container starts
                        self.html_block_type = 0;

                        n_brothers += 1;
                        continue;
                    }
                }
            }

            // Check for indented code
            if line.indent >= self.code_indent_offset && effective_pivot_type != LineType::Text {
                line.r#type = LineType::IndentedCode;
                line.indent -= self.code_indent_offset;
                line.data = 0;
                break;
            }

            // Check for new container block
            if line.indent < self.code_indent_offset {
                let cont_result = self.is_container_mark(line.indent, off);
                if cont_result.is_container {
                    container = cont_result.container;

                    // List mark can't interrupt paragraph unless it's > or ordered starting at 1
                    if effective_pivot_type == LineType::Text && n_parents == self.n_containers {
                        if (cont_result.off >= self.size
                            || helpers::is_newline(self.ch(cont_result.off)))
                            && container.ch != b'>'
                        {
                            // Blank after list mark can't interrupt paragraph
                        } else if (container.ch == b'.' || container.ch == b')')
                            && container.start != 1
                        {
                            // Ordered list with start != 1 can't interrupt paragraph
                        } else {
                            off = cont_result.off;
                            total_indent += container.contents_indent - container.mark_indent;
                            let r = helpers::line_indentation(self.text, total_indent, off);
                            line.indent = r.indent;
                            total_indent += line.indent;
                            off = r.off;
                            line.beg = off;
                            line.data = container.ch as u32;

                            if off >= self.size || helpers::is_newline(self.text[off as usize]) {
                                container.contents_indent += 1;
                            } else if line.indent <= self.code_indent_offset {
                                container.contents_indent += line.indent;
                                line.indent = 0;
                            } else {
                                container.contents_indent += 1;
                                line.indent -= 1;
                            }

                            if n_brothers + n_children == 0 {
                                effective_pivot_type = LineType::Blank;
                            }

                            if n_children == 0 {
                                self.end_current_block()?;
                                self.leave_child_containers(n_parents + n_brothers)?;
                            }

                            n_children += 1;
                            self.push_container(&container)?;
                            continue;
                        }
                    } else {
                        off = cont_result.off;
                        total_indent += container.contents_indent - container.mark_indent;
                        let r = helpers::line_indentation(self.text, total_indent, off);
                        line.indent = r.indent;
                        total_indent += line.indent;
                        off = r.off;
                        line.beg = off;
                        line.data = container.ch as u32;

                        if off >= self.size || helpers::is_newline(self.text[off as usize]) {
                            container.contents_indent += 1;
                        } else if line.indent <= self.code_indent_offset {
                            container.contents_indent += line.indent;
                            line.indent = 0;
                        } else {
                            container.contents_indent += 1;
                            line.indent -= 1;
                        }

                        if n_brothers + n_children == 0 {
                            effective_pivot_type = LineType::Blank;
                        }

                        if n_children == 0 {
                            self.end_current_block()?;
                            self.leave_child_containers(n_parents + n_brothers)?;
                        }

                        n_children += 1;
                        self.push_container(&container)?;
                        continue;
                    }
                }
            }

            // Check for table continuation
            if effective_pivot_type == LineType::Table && n_parents == self.n_containers {
                line.r#type = LineType::Table;
                break;
            }

            // Check for ATX header
            if line.indent < self.code_indent_offset
                && off < self.size
                && self.text[off as usize] == b'#'
            {
                let atx_result = self.is_atx_header_line(off);
                if atx_result.is_atx {
                    line.r#type = LineType::AtxHeader;
                    line.data = atx_result.level;
                    line.beg = atx_result.content_beg;

                    // Trim trailing whitespace
                    while line.end > line.beg
                        && (helpers::is_blank(self.text[(line.end - 1) as usize])
                            || self.text[(line.end - 1) as usize] == b'\t')
                    {
                        line.end -= 1;
                    }
                    // Trim optional closing # sequence
                    if line.end > line.beg && self.text[(line.end - 1) as usize] == b'#' {
                        let mut tmp = line.end;
                        while tmp > line.beg && self.text[(tmp - 1) as usize] == b'#' {
                            tmp -= 1;
                        }
                        // The closing # must be preceded by space (or be the entire content)
                        if tmp == line.beg || helpers::is_blank(self.text[(tmp - 1) as usize]) {
                            line.end = tmp;
                            // Trim trailing whitespace again
                            while line.end > line.beg
                                && helpers::is_blank(self.text[(line.end - 1) as usize])
                            {
                                line.end -= 1;
                            }
                        }
                    }

                    break;
                }
            }

            // Check for opening code fence
            if line.indent < self.code_indent_offset
                && off < self.size
                && (self.text[off as usize] == b'`' || self.text[off as usize] == b'~')
            {
                let fence_result = self.is_opening_code_fence(off);
                if fence_result.is_fence {
                    line.r#type = LineType::FencedCode;
                    line.data = fence_result.fence_data;
                    line.enforce_new_block = true;
                    break;
                }
            }

            // Check for HTML block start
            if off < self.size && self.text[off as usize] == b'<' && !self.flags.no_html_blocks {
                self.html_block_type = self.is_html_block_start_condition(off);

                // Type 7 can't interrupt paragraph
                if self.html_block_type == 7 && effective_pivot_type == LineType::Text {
                    self.html_block_type = 0;
                }

                if self.html_block_type > 0 {
                    if self.is_html_block_end_condition(off, self.html_block_type) {
                        self.html_block_type = 0;
                    }
                    line.enforce_new_block = true;
                    line.r#type = LineType::Html;
                    break;
                }
            }

            // Check for table underline
            if self.flags.tables
                && effective_pivot_type == LineType::Text
                && off < self.size
                && (self.text[off as usize] == b'|'
                    || self.text[off as usize] == b'-'
                    || self.text[off as usize] == b':')
                && n_parents == self.n_containers
            {
                let tbl_result = self.is_table_underline(off);
                if tbl_result.is_underline
                    && self.current_block.is_some()
                    && self.current_block_lines.len() >= 1
                {
                    // GFM: validate that header row column count matches delimiter row column count.
                    let header_line =
                        self.current_block_lines[self.current_block_lines.len() - 1];
                    let header_cols =
                        self.count_table_row_columns(header_line.beg, header_line.end);
                    if header_cols == tbl_result.col_count {
                        line.data = tbl_result.col_count;
                        line.r#type = LineType::TableUnderline;
                        break;
                    }
                }
            }

            // Default: normal text line
            line.r#type = LineType::Text;
            if effective_pivot_type == LineType::Text && n_brothers + n_children == 0 {
                // Lazy continuation
                n_parents = self.n_containers;
            }

            // Check for task mark
            if self.flags.tasklists
                && n_brothers + n_children > 0
                && self.n_containers > 0
                && is_list_item_mark(self.containers[(self.n_containers - 1) as usize].ch)
            {
                let mut tmp = off;
                while tmp < self.size
                    && tmp < off + 3
                    && helpers::is_blank(self.text[tmp as usize])
                {
                    tmp += 1;
                }
                if tmp + 2 < self.size
                    && self.text[tmp as usize] == b'['
                    && (self.text[(tmp + 1) as usize] == b'x'
                        || self.text[(tmp + 1) as usize] == b'X'
                        || self.text[(tmp + 1) as usize] == b' ')
                    && self.text[(tmp + 2) as usize] == b']'
                    && (tmp + 3 == self.size
                        || helpers::is_blank(self.text[(tmp + 3) as usize])
                        || helpers::is_newline(self.text[(tmp + 3) as usize]))
                {
                    let task_container = if n_children > 0 {
                        &mut self.containers[(self.n_containers - 1) as usize]
                    } else {
                        &mut container
                    };
                    task_container.is_task = true;
                    task_container.task_mark_off = OFF::try_from(tmp + 1).unwrap();
                    off = OFF::try_from(tmp + 3).unwrap();
                    while off < self.size && helpers::is_whitespace(self.text[off as usize]) {
                        off += 1;
                    }
                    line.beg = off;
                }
            }

            break;
        }

        // Scan for end of line
        while off < self.size && !helpers::is_newline(self.text[off as usize]) {
            off += 1;
        }

        line.end = off;

        // Trim trailing closing marks for ATX header
        if line.r#type == LineType::AtxHeader {
            let mut tmp = line.end;
            while tmp > line.beg && helpers::is_blank(self.text[(tmp - 1) as usize]) {
                tmp -= 1;
            }
            while tmp > line.beg && self.text[(tmp - 1) as usize] == b'#' {
                tmp -= 1;
            }
            if tmp == line.beg
                || helpers::is_blank(self.text[(tmp - 1) as usize])
                || self.flags.permissive_atx_headers
            {
                line.end = tmp;
            }
        }

        // Trim trailing spaces (except for code/HTML/text)
        // Text lines keep trailing spaces for hard line break detection
        if line.r#type != LineType::IndentedCode
            && line.r#type != LineType::FencedCode
            && line.r#type != LineType::Html
            && line.r#type != LineType::Text
        {
            while line.end > line.beg && helpers::is_blank(self.text[(line.end - 1) as usize]) {
                line.end -= 1;
            }
        }

        // Eat newline
        if off < self.size && self.text[off as usize] == b'\r' {
            off += 1;
        }
        if off < self.size && self.text[off as usize] == b'\n' {
            off += 1;
        }

        *p_end = off;

        // Loose list detection
        if prev_line_has_list_loosening_effect
            && line.r#type != LineType::Blank
            && n_parents + n_brothers > 0
        {
            let ci = (n_parents + n_brothers - 1) as usize;
            if ci < self.containers.len() && self.containers[ci].ch != b'>' {
                self.containers[ci].is_loose = true;
            }
        }

        // Flush current leaf block before any container transitions
        // so that VerbatimLine data stays contiguous after its BlockHeader.
        if (n_children == 0 && n_parents + n_brothers < self.n_containers)
            || n_brothers > 0
            || n_children > 0
        {
            self.end_current_block()?;
        }

        // Leave containers we're no longer part of
        if n_children == 0 && n_parents + n_brothers < self.n_containers {
            self.leave_child_containers(n_parents + n_brothers)?;
        }

        // Enter brother containers
        if n_brothers > 0 {
            // Close old LI, open new LI
            self.push_container_bytes(
                BlockType::Li,
                if self.containers[n_parents as usize].is_task {
                    self.text[self.containers[n_parents as usize].task_mark_off as usize] as u32
                } else {
                    0
                },
                types::BLOCK_CONTAINER_CLOSER,
            )?;
            self.push_container_bytes(
                BlockType::Li,
                if container.is_task {
                    self.text[container.task_mark_off as usize] as u32
                } else {
                    0
                },
                types::BLOCK_CONTAINER_OPENER,
            )?;
            self.containers[n_parents as usize].is_task = container.is_task;
            self.containers[n_parents as usize].task_mark_off = container.task_mark_off;
        }

        if n_children > 0 {
            self.enter_child_containers(n_children)?;
        }

        Ok(())
    }

    pub fn process_line(
        &mut self,
        pivot_line: &mut Line,
        cur_line_idx: usize,
        line_buf: &mut [Line; 2],
        line_idx: &mut usize,
    ) -> Result<(), bun_alloc::AllocError> {
        // PORT NOTE: reshaped for borrowck — Zig passed `line: *Line` aliasing into line_buf;
        // here we index into line_buf via cur_line_idx.
        let line = &mut line_buf[cur_line_idx];

        // Blank line ends current leaf block.
        // Note: blank lines inside fenced code blocks are typed .fencedcode by analyzeLine,
        // and blank lines inside HTML blocks type 1-5 are typed .html by analyzeLine.
        // Only closing fences and actual block-ending blank lines reach here as .blank.
        if line.r#type == LineType::Blank {
            self.end_current_block()?;
            *pivot_line = Line { r#type: LineType::Blank, ..Line::default() };
            return Ok(());
        }

        // Opening code fence: start block but don't include fence line as content
        if line.r#type == LineType::FencedCode && line.enforce_new_block {
            self.end_current_block()?;
            self.start_new_block(line)?;
            self.fence_indent = line.indent;

            // Extract info string position and store in block data
            if let Some(cb_off) = self.current_block {
                let fence_count = line.data >> 8;
                let mut info_beg: OFF = line.beg + fence_count;
                // Skip whitespace before info string
                while info_beg < line.end && helpers::is_blank(self.text[info_beg as usize]) {
                    info_beg += 1;
                }
                let hdr = self.get_block_header_at(cb_off);
                hdr.data = info_beg;
                hdr.flags |= types::BLOCK_FENCED_CODE;
            }
            *pivot_line = *line;
            return Ok(());
        }

        if line.enforce_new_block {
            self.end_current_block()?;
        }

        // Single-line blocks
        if line.r#type == LineType::Hr || line.r#type == LineType::AtxHeader {
            self.end_current_block()?;
            self.start_new_block(line)?;
            self.add_line_to_current_block(line)?;
            self.end_current_block()?;
            *pivot_line = Line { r#type: LineType::Blank, ..Line::default() };
            return Ok(());
        }

        // Setext underline changes current block to header
        if line.r#type == LineType::SetextUnderline {
            if let Some(cb_off) = self.current_block {
                let blk = self.get_block_at(cb_off);
                blk.block_type = BlockType::H;
                blk.data = line.data;
                blk.flags |= types::BLOCK_SETEXT_HEADER;
            }
            // Add the underline line (md4c stores it for ref def interaction)
            self.add_line_to_current_block(line)?;
            self.end_current_block()?;
            if self.current_block.is_none() {
                // Block was closed normally
                *pivot_line = Line { r#type: LineType::Blank, ..Line::default() };
            } else {
                // Block stayed open: all body was consumed as link ref defs,
                // underline downgraded to start of a new paragraph (md4c behavior)
                line.r#type = LineType::Text;
                *pivot_line = *line;
            }
            return Ok(());
        }

        // Table underline
        if line.r#type == LineType::TableUnderline {
            if let Some(cb_off) = self.current_block {
                if self.current_block_lines.len() > 1 {
                    // GFM: table interrupts paragraph. Split: lines 0..N-2 stay as paragraph,
                    // last line becomes table header.
                    let last_line =
                        self.current_block_lines[self.current_block_lines.len() - 1];
                    // Remove the last line from current paragraph block
                    let _ = self.current_block_lines.pop();
                    let hdr = self.get_block_header_at(cb_off);
                    hdr.n_lines -= 1;
                    // End the paragraph
                    self.end_current_block()?;
                    // Start a new table block with the saved header line
                    let header_as_line = Line {
                        r#type: LineType::Table,
                        beg: last_line.beg,
                        end: last_line.end,
                        indent: last_line.indent,
                        data: line.data,
                        ..Line::default()
                    };
                    self.start_new_block(&header_as_line)?;
                    self.add_line_to_current_block(&header_as_line)?;
                } else {
                    // Single line paragraph: convert directly to table
                    let blk = self.get_block_at(cb_off);
                    blk.block_type = BlockType::Table;
                    blk.data = line.data;
                }
            }
            // Change pivot to table
            pivot_line.r#type = LineType::Table;
            self.add_line_to_current_block(line)?;
            return Ok(());
        }

        // Different line type ends current block
        if line.r#type != pivot_line.r#type {
            self.end_current_block()?;
        }

        // Start new block if needed
        if self.current_block.is_none() {
            self.start_new_block(line)?;
            *pivot_line = *line;
        }

        // Add line to current block
        self.add_line_to_current_block(line)?;

        // Ensure we alternate line buffers to avoid aliasing
        let _ = line_buf;
        *line_idx ^= 1;
        Ok(())
    }

    pub fn start_new_block(&mut self, line: &Line) -> Result<(), bun_alloc::AllocError> {
        let block_type: BlockType = match line.r#type {
            LineType::Hr => BlockType::Hr,
            LineType::AtxHeader => BlockType::H,
            LineType::FencedCode | LineType::IndentedCode => BlockType::Code,
            LineType::Html => BlockType::Html,
            LineType::Table | LineType::TableUnderline => BlockType::Table,
            _ => BlockType::P,
        };

        // Align block_bytes for Block alignment
        let align_mask: usize = align_of::<BlockHeader>() - 1;
        let cur_len = self.block_bytes.len();
        let aligned = (cur_len + align_mask) & !align_mask;
        let needed = aligned + size_of::<BlockHeader>();
        self.block_bytes
            .reserve(needed.saturating_sub(self.block_bytes.len()));
        // Zero-pad
        while self.block_bytes.len() < aligned {
            self.block_bytes.push(0);
        }
        // SAFETY: capacity reserved above; bytes between aligned..needed are immediately
        // overwritten by the BlockHeader write below.
        unsafe { self.block_bytes.set_len(needed) };

        let hdr = self.get_block_header_at(aligned);
        *hdr = BlockHeader {
            block_type,
            flags: 0,
            data: line.data,
            n_lines: 0,
        };

        self.current_block = Some(aligned);
        self.current_block_lines.clear();
        Ok(())
    }

    pub fn add_line_to_current_block(&mut self, line: &Line) -> Result<(), bun_alloc::AllocError> {
        if let Some(cb_off) = self.current_block {
            let hdr = self.get_block_header_at(cb_off);
            hdr.n_lines += 1;
            self.current_block_lines.push(VerbatimLine {
                beg: line.beg,
                end: line.end,
                indent: line.indent,
            });
        }
        Ok(())
    }

    pub fn end_current_block(&mut self) -> Result<(), bun_alloc::AllocError> {
        if let Some(cb_off) = self.current_block {
            let mut hdr = self.get_block_header_at(cb_off);

            // Consume link ref defs from setext headings (md4c: md_end_current_block).
            // For regular paragraphs, ref defs are consumed in buildRefDefHashtable.
            let is_setext =
                hdr.block_type == BlockType::H && (hdr.flags & types::BLOCK_SETEXT_HEADER) != 0;
            if is_setext
                && hdr.n_lines > 0
                && self.current_block_lines.len() > 0
                && self.current_block_lines[0].beg < self.size
                && self.text[self.current_block_lines[0].beg as usize] == b'['
            {
                self.consume_ref_defs_from_current_block();
                hdr = self.get_block_header_at(cb_off);
            }

            // Handle setext heading after ref def consumption
            if hdr.block_type == BlockType::H && (hdr.flags & types::BLOCK_SETEXT_HEADER) != 0 {
                if hdr.n_lines > 1 {
                    // Remove the underline (last line)
                    hdr.n_lines -= 1;
                    let _ = self.current_block_lines.pop();
                } else if hdr.n_lines == 1 {
                    // Only underline left after eating ref defs → convert to paragraph,
                    // keep block open so subsequent lines join this paragraph (md4c behavior)
                    hdr.block_type = BlockType::P;
                    hdr.flags &= !(types::BLOCK_SETEXT_HEADER as u32);
                    return Ok(()); // Don't close the block!
                } else {
                    // All lines consumed (shouldn't normally happen)
                    hdr.flags |= types::BLOCK_REF_DEF_ONLY;
                }
            }

            // Write accumulated lines to block_bytes
            // SAFETY: VerbatimLine is POD; reinterpret slice as bytes for serialization
            let line_bytes: &[u8] = unsafe {
                core::slice::from_raw_parts(
                    self.current_block_lines.as_ptr().cast::<u8>(),
                    self.current_block_lines.len() * size_of::<VerbatimLine>(),
                )
            };
            self.block_bytes.extend_from_slice(line_bytes);
            self.current_block = None;
        }
        Ok(())
    }

    pub fn consume_ref_defs_from_current_block(&mut self) {
        let items = self.current_block_lines.as_slice();
        if items.is_empty() {
            return;
        }

        // Merge lines into buffer for ref def parsing
        self.buffer.clear();
        for vline in items {
            if vline.beg > vline.end || vline.end > self.size {
                continue;
            }
            if self.buffer.len() > 0 {
                self.buffer.push(b'\n');
            }
            self.buffer
                .extend_from_slice(&self.text[vline.beg as usize..vline.end as usize]);
        }

        // PORT NOTE: reshaped for borrowck — re-borrow buffer after filling
        let merged_len = self.buffer.len();
        let mut pos: usize = 0;
        let mut lines_consumed: u32 = 0;

        while pos < merged_len {
            let merged = self.buffer.as_slice();
            let Some(result) = self.parse_ref_def(merged, pos) else {
                break;
            };

            let norm_label = self.normalize_label(result.label);
            if norm_label.is_empty() {
                break;
            }

            // First definition wins
            let mut already_exists = false;
            for existing in self.ref_defs.iter() {
                if existing.label.as_ref() == norm_label.as_ref() {
                    already_exists = true;
                    break;
                }
            }
            if !already_exists {
                let dest_dupe = Box::<[u8]>::from(result.dest);
                let title_dupe = Box::<[u8]>::from(result.title);
                self.ref_defs.push(types::RefDef {
                    label: norm_label,
                    dest: dest_dupe,
                    title: title_dupe,
                });
                // TODO(port): Zig used `catch return` on push; Vec::push is infallible here
            }

            let merged = self.buffer.as_slice();
            let mut newlines: u32 = 0;
            for &mc in &merged[pos..result.end_pos] {
                if mc == b'\n' {
                    newlines += 1;
                }
            }
            if result.end_pos >= merged.len()
                && (result.end_pos == pos || merged[result.end_pos - 1] != b'\n')
            {
                newlines += 1;
            }
            lines_consumed += newlines;
            pos = result.end_pos;
        }

        if lines_consumed > 0 {
            if let Some(cb_off) = self.current_block {
                let hdr = self.get_block_header_at(cb_off);
                if lines_consumed >= hdr.n_lines {
                    // All lines consumed
                    self.current_block_lines.clear();
                    hdr.n_lines = 0;
                } else {
                    // Remove first lines_consumed lines
                    let total = self.current_block_lines.len();
                    let remaining = total - lines_consumed as usize;
                    // SAFETY: ranges overlap (src after dst); copy_within handles memmove semantics
                    self.current_block_lines
                        .copy_within(lines_consumed as usize..total, 0);
                    self.current_block_lines.truncate(remaining);
                    hdr.n_lines -= lines_consumed;
                }
            }
        }
    }

    pub fn get_block_header_at(&mut self, off: usize) -> &mut BlockHeader {
        // SAFETY: off is an aligned offset into block_bytes produced by start_new_block /
        // push_container_bytes; the buffer holds a valid BlockHeader at that offset.
        // TODO(port): borrowck — this returns &mut into self.block_bytes while other
        // &mut self borrows may be live at call sites; Phase B may need raw *mut.
        unsafe { &mut *(self.block_bytes.as_mut_ptr().add(off).cast::<BlockHeader>()) }
    }

    pub fn get_block_at(&mut self, off: usize) -> &mut BlockHeader {
        self.get_block_header_at(off)
    }
}

// TODO(port): `Line.type` field — Zig uses `.type`; Rust uses `r#type`. The variant
// type is assumed to be `types::LineType` re-exported here for brevity.
use crate::types::LineType;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/md/blocks.zig (865 lines)
//   confidence: medium
//   todos:      3
//   notes:      All fns are `impl Parser` methods; get_block_header_at returns &mut into Vec<u8> (borrowck hazard); process_line signature reshaped to pass line_buf+idx instead of aliasing *Line; RefDef struct name/shape assumed from types.zig.
// ──────────────────────────────────────────────────────────────────────────
