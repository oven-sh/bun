use crate::autolinks::is_list_item_mark;
use crate::compat;
use crate::helpers;
use crate::parser::{self, Parser};
use crate::types::{self, BlockType, Container, Line, OFF, VerbatimLine};

use core::mem::size_of;

type BlockHeader = parser::BlockHeader;

impl Parser<'_> {
    pub(crate) fn process_doc(&mut self) -> Result<(), parser::Error> {
        let dummy_blank = Line {
            r#type: LineType::Blank,
            ..Line::default()
        };
        let mut pivot_line = dummy_blank;
        let mut line_buf: [Line; 2] = [Line::default(), Line::default()];
        let mut line_idx: usize = 0;
        let mut off: OFF = 0;

        self.enter_block(BlockType::Doc, 0, 0)?;

        while off < self.size {
            let line = &mut line_buf[line_idx];

            self.analyze_line(off, &mut off, &pivot_line, line)?;
            // Pass the whole buf + idx so process_line can swap lines.
            self.process_line(&mut pivot_line, line_idx, &mut line_buf, &mut line_idx)?;
        }

        self.end_current_block()?;
        if self.track {
            self.renderer.ptr.line_starts(&self.line_starts);
        }

        // Build ref def hashtable
        self.build_ref_def_hashtable()?;

        // Process all blocks
        self.line_beg = OFF::MAX;
        self.leave_child_containers(0)?;
        self.process_all_blocks()?;

        self.leave_block(BlockType::Doc, 0)?;
        Ok(())
    }

    pub(crate) fn analyze_line(
        &mut self,
        off_start: OFF,
        p_end: &mut OFF,
        pivot_line: &Line,
        line: &mut Line,
    ) -> Result<(), parser::Error> {
        let mut off = off_start;
        self.line_beg = off_start;
        if self.track {
            self.line_starts.push(off_start);
        }
        let mut total_indent: u32 = 0;
        let mut n_parents: u32 = 0;
        let mut n_brothers: u32 = 0;
        let mut n_children: u32 = 0;
        let mut container = Container::default();
        let prev_line_has_list_loosening_effect = self.last_line_has_list_loosening_effect;
        // The line before is the marker of a list item and nothing else.
        let follows_empty_item = self.last_header_opens_list_item
            && self.current_block.is_none()
            && !self.last_list_item_starts_with_two_blank_lines;
        let follows_task_mark = core::mem::take(&mut self.last_line_is_only_a_task_mark);
        // Nothing is on the line but the markers of containers that were open before it.
        let mut is_empty = false;

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
        self.is_directive_end = false;
        while n_parents < self.n_containers {
            let c = &self.containers[n_parents as usize];
            if c.ch == b':' {
                // Its end comes before anything that is open in it sees the line
                if remaining_indent < self.code_indent_offset && self.ends_directive(off, c.start) {
                    self.is_directive_end = true;
                    break;
                }
                remaining_indent -= remaining_indent.min(c.contents_indent);
                line.indent = remaining_indent;
                n_parents += 1;
                continue;
            }
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
                    line.indent = 0;
                }
            }
        }

        // Track effective pivot type — brother/child containers reset this to .blank
        let mut effective_pivot_type = pivot_line.r#type;

        let interrupts_for_micromark =
            compat::what_interrupts_does_so_for_the_whole_line(&self.flags)
                && n_parents == self.n_containers
                && matches!(pivot_line.r#type, LineType::Text | LineType::Indentedcode);

        // Determine line type
        loop {
            if self.is_directive_end {
                line.r#type = LineType::Blank;
                self.html_block_type = 0;
                break;
            }

            // Check for fenced code continuation/closing (BEFORE blank line check, like md4c)
            if effective_pivot_type == LineType::Fencedcode {
                line.beg = off;

                // Check for closing fence
                if line.indent < self.code_indent_offset && n_parents == self.n_containers {
                    if self.is_closing_code_fence(off, pivot_line.data) {
                        line.r#type = LineType::Blank; // ending fence treated as blank
                        self.last_line_has_list_loosening_effect = false;
                        if let Some(cb_off) = self.current_block {
                            self.get_block_header_at(cb_off).flags |= types::BLOCK_CLOSED;
                        }
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
                    line.r#type = LineType::Fencedcode;
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
                    if self.is_html_block_end_condition(off, self.html_block_type)
                        && !(line.indent > 0
                            && self.html_block_type >= 6
                            && compat::only_a_line_without_blanks_ends_html(&self.flags))
                    {
                        // Save type before clearing (md4c uses a local variable)
                        let ended_type = self.html_block_type;
                        self.html_block_type = 0;

                        // Types 6 and 7 end conditions also serve as blank lines
                        if ended_type == 6 || ended_type == 7 {
                            line.r#type = LineType::Blank;
                            line.indent = 0;
                            is_empty = true;
                            break;
                        }
                        if let Some(cb_off) = self.current_block {
                            self.get_block_header_at(cb_off).flags |= types::BLOCK_CLOSED;
                        }
                    }
                    line.r#type = LineType::Html;
                    n_parents = self.n_containers;
                    break;
                }
            }

            // Check for blank line
            if off >= self.size || helpers::is_newline(self.text[off as usize]) {
                is_empty = n_brothers + n_children == 0;
                // Indented code continuation through blank lines
                if effective_pivot_type == LineType::Indentedcode && n_parents == self.n_containers
                {
                    line.r#type = LineType::Indentedcode;
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
                        && !self.containers[(n_parents - 1) as usize].is_task
                        && n_brothers + n_children == 0
                        && self.current_block.is_none()
                        && self.last_header_opens_list_item
                    {
                        self.last_list_item_starts_with_two_blank_lines = true;
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
                        && self.last_header_opens_list_item
                    {
                        n_parents -= 1;
                        line.indent = total_indent;
                        if n_parents > 0 {
                            line.indent -= line
                                .indent
                                .min(self.containers[(n_parents - 1) as usize].contents_indent);
                        }
                    }
                    self.last_list_item_starts_with_two_blank_lines = false;
                }
                self.last_line_has_list_loosening_effect = false;
            }

            // Indented code continuation
            if effective_pivot_type == LineType::Indentedcode {
                if line.indent >= self.code_indent_offset {
                    line.r#type = LineType::Indentedcode;
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
                if setext_result.is_setext && !self.current_block_is_only_ref_defs() {
                    line.r#type = LineType::Setextunderline;
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
                        container.mark_beg = off;
                        container.mark_end = cont_result.off;
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
                        self.containers[n_parents as usize].mark_beg = container.mark_beg;
                        self.containers[n_parents as usize].mark_end = container.mark_end;

                        // HTML block ends when a new sibling container starts
                        self.html_block_type = 0;

                        n_brothers += 1;
                        continue;
                    }
                }
            }

            // Check for indented code
            if line.indent >= self.code_indent_offset && effective_pivot_type != LineType::Text {
                line.r#type = LineType::Indentedcode;
                line.indent -= self.code_indent_offset;
                line.data = 0;
                break;
            }

            // Check for new container block
            if line.indent < self.code_indent_offset {
                let cont_result = self.is_container_mark(line.indent, off);
                if cont_result.is_container {
                    container = cont_result.container;
                    container.mark_beg = off;
                    container.mark_end = cont_result.off;

                    // List mark can't interrupt paragraph unless it's > or ordered starting at 1
                    if (effective_pivot_type == LineType::Text && n_parents == self.n_containers)
                        || interrupts_for_micromark
                    {
                        let after_mark =
                            helpers::line_indentation(self.text, 0, cont_result.off).off;
                        if (after_mark >= self.size || helpers::is_newline(self.ch(after_mark)))
                            && container.ch != b'>'
                            && container.ch != b'^'
                            && container.ch != b':'
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
                            } else if container.ch == b'>' {
                                // Only the 1st space after '>' is part of the mark
                                line.indent = line.indent.saturating_sub(1);
                            } else if line.indent <= self.code_indent_offset {
                                container.contents_indent += line.indent;
                                line.indent = 0;
                            } else {
                                container.contents_indent += 1;
                                line.indent -= 1;
                            }
                            if container.ch == b'^' {
                                container.contents_indent = 4;
                                line.indent = 0;
                            }
                            if container.ch == b':' {
                                container.contents_indent = container.mark_indent;
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
                        } else if container.ch == b'>' {
                            // Only the 1st space after '>' is part of the mark
                            line.indent = line.indent.saturating_sub(1);
                        } else if line.indent <= self.code_indent_offset {
                            container.contents_indent += line.indent;
                            line.indent = 0;
                        } else {
                            container.contents_indent += 1;
                            line.indent -= 1;
                        }
                        if container.ch == b'^' {
                            container.contents_indent = 4;
                            line.indent = 0;
                        }
                        if container.ch == b':' {
                            container.contents_indent = container.mark_indent;
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

            // Check for ATX header
            if line.indent < self.code_indent_offset
                && off < self.size
                && self.text[off as usize] == b'#'
            {
                let atx_result = self.is_atx_header_line(off);
                if atx_result.is_atx {
                    line.r#type = LineType::Atxheader;
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
                && (self.text[off as usize] == b'`'
                    || self.text[off as usize] == b'~'
                    || (self.text[off as usize] == b'$' && self.flags.math_blocks))
            {
                let fence_result = self.is_opening_code_fence(off);
                if fence_result.is_fence {
                    line.r#type = LineType::Fencedcode;
                    line.data = fence_result.fence_data;
                    line.enforce_new_block = true;
                    break;
                }
            }

            // Check for HTML block start
            if line.indent < self.code_indent_offset
                && off < self.size
                && self.text[off as usize] == b'<'
                && !self.flags.no_html_blocks
            {
                self.html_block_type = self.is_html_block_start_condition(off);

                // Type 7 can't interrupt paragraph
                if self.html_block_type == 7 && effective_pivot_type == LineType::Text {
                    if n_parents < self.n_containers
                        && n_brothers + n_children == 0
                        && compat::complete_tag_ends_lazy_paragraph(&self.flags)
                    {
                        n_parents = self.n_containers;
                    } else {
                        self.html_block_type = 0;
                    }
                }
                if self.html_block_type > 0
                    && effective_pivot_type == LineType::Text
                    && n_brothers + n_children == 0
                    && compat::tag_does_not_end_a_list(&self.flags)
                    && self.containers_up_to_quote() <= n_parents
                {
                    n_parents = self.n_containers;
                }

                if self.html_block_type > 0 {
                    line.data = if self.html_block_type <= 5 {
                        types::BLOCK_HTML_UNTIL_TEXT
                    } else {
                        0
                    };
                    if self.is_html_block_end_condition(off, self.html_block_type) {
                        self.html_block_type = 0;
                        line.data |= types::BLOCK_CLOSED;
                    }
                    line.enforce_new_block = true;
                    line.r#type = LineType::Html;
                    break;
                }
            }

            // Check for a leaf block of the consumer's own
            if let Some(extensions) = self.extensions
                && line.indent < self.code_indent_offset
                && off < self.size
                && self.starts_extension_leaf[self.text[off as usize] as usize]
            {
                let interrupts_paragraph = effective_pivot_type == LineType::Text;
                let end = (extensions.leaf)(&types::LeafStart {
                    text: self.text,
                    off,
                    indent: line.indent,
                    is_in_container: if interrupts_paragraph && n_brothers + n_children == 0 {
                        self.n_containers > 0
                    } else {
                        n_parents + n_brothers + n_children > 0
                    },
                    interrupts_paragraph,
                    starts_container: &|line_beg| self.starts_container_in_paragraph(line_beg),
                });
                if let Some(end) = end {
                    self.html_block_type = 0;
                    line.data = types::BLOCK_EXTENSION | types::BLOCK_CLOSED;
                    line.enforce_new_block = true;
                    line.r#type = LineType::Html;
                    let end = end.clamp(off, self.size);
                    while self.track
                        && let Some(len) = bun_core::strings::index_of_char_usize(
                            &self.text[off as usize..end as usize],
                            b'\n',
                        )
                    {
                        off += len as OFF + 1;
                        self.line_starts.push(off);
                    }
                    off = end;
                    break;
                }
            }

            // Check for table continuation
            if effective_pivot_type == LineType::Table && n_parents == self.n_containers {
                line.r#type = LineType::Table;
                break;
            }

            // Check for table underline
            if self.flags.tables
                && line.indent < self.code_indent_offset
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
                    let header_line = self.current_block_lines[self.current_block_lines.len() - 1];
                    let header_cols =
                        self.count_table_row_columns(header_line.beg, header_line.end);
                    let is_header_too_far_in = header_line.indent >= self.code_indent_offset
                        && compat::indented_line_is_no_table_header(&self.flags);
                    let interrupts_paragraph = self.current_block_lines.len() > 1
                        && compat::table_does_not_interrupt_a_paragraph(&self.flags);
                    if (header_cols == tbl_result.col_count
                        || compat::table_header_has_any_number_of_cells(&self.flags))
                        && !is_header_too_far_in
                        && !interrupts_paragraph
                    {
                        line.data = tbl_result.col_count;
                        line.r#type = LineType::Tableunderline;
                        break;
                    }
                }
            }

            // Default: normal text line
            line.r#type = LineType::Text;
            if (effective_pivot_type == LineType::Text
                || (follows_empty_item
                    && (follows_task_mark || compat::text_goes_on_in_an_empty_item(&self.flags))))
                && n_brothers + n_children == 0
                && self.directives.last().is_none_or(|it| *it < n_parents)
            {
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
                while tmp < self.size && tmp < off + 3 && helpers::is_blank(self.text[tmp as usize])
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
                    task_container.task_mark_off = OFF::try_from(tmp + 1).expect("int cast");
                    off = OFF::try_from(tmp + 3).expect("int cast");
                    while off < self.size && helpers::is_blank(self.text[off as usize]) {
                        off += 1;
                    }
                    line.beg = off;
                    // Nothing else is on the line
                    if off >= self.size || helpers::is_newline(self.text[off as usize]) {
                        line.r#type = LineType::Blank;
                        self.last_line_is_only_a_task_mark = true;
                    }
                }
            }

            break;
        }

        // Scan for end of line
        let rest = &self.text[off as usize..];
        off = match if self.has_carriage_return {
            bun_core::strings::index_of_any(rest, b"\r\n")
        } else {
            bun_core::strings::index_of_char_usize(rest, b'\n')
        } {
            Some(len) => off + len as OFF,
            None => self.size,
        };

        line.end = off;
        let raw_end = off;

        // Trim trailing closing marks for ATX header
        if line.r#type == LineType::Atxheader {
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
        if line.r#type != LineType::Indentedcode
            && line.r#type != LineType::Fencedcode
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
        self.is_directive_end = false;

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
                (self.line_beg, self.container_end(n_parents), 0),
            )?;
            self.push_container_bytes(
                BlockType::Li,
                if container.is_task {
                    self.text[container.task_mark_off as usize] as u32
                } else {
                    0
                },
                types::BLOCK_CONTAINER_OPENER,
                (
                    self.containers[n_parents as usize].mark_beg,
                    self.containers[n_parents as usize].mark_end,
                    self.containers[n_parents as usize].mark_indent,
                ),
            )?;
            self.containers[n_parents as usize].is_task = container.is_task;
            self.containers[n_parents as usize].task_mark_off = container.task_mark_off;
        }

        if n_children > 0 {
            self.enter_child_containers(n_children)?;
        }

        if self.track {
            let count = match is_empty {
                true => self.containers_up_to_quote(),
                false => self.n_containers,
            };
            self.set_container_ends(count, raw_end);
        }

        Ok(())
    }

    pub(crate) fn process_line(
        &mut self,
        pivot_line: &mut Line,
        cur_line_idx: usize,
        line_buf: &mut [Line; 2],
        line_idx: &mut usize,
    ) -> Result<(), parser::Error> {
        // Index into line_buf via cur_line_idx instead of taking a `&mut Line`
        // parameter, which would alias line_buf.
        let line = &mut line_buf[cur_line_idx];

        // Blank line ends current leaf block.
        // Note: blank lines inside fenced code blocks are typed .fencedcode by analyzeLine,
        // and blank lines inside HTML blocks type 1-5 are typed .html by analyzeLine.
        // Only closing fences and actual block-ending blank lines reach here as .blank.
        if line.r#type == LineType::Blank {
            self.end_current_block()?;
            *pivot_line = Line {
                r#type: LineType::Blank,
                ..Line::default()
            };
            return Ok(());
        }

        // Opening code fence: start block but don't include fence line as content
        if line.r#type == LineType::Fencedcode && line.enforce_new_block {
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
        if line.r#type == LineType::Hr || line.r#type == LineType::Atxheader {
            self.end_current_block()?;
            self.start_new_block(line)?;
            self.add_line_to_current_block(line)?;
            self.end_current_block()?;
            *pivot_line = Line {
                r#type: LineType::Blank,
                ..Line::default()
            };
            return Ok(());
        }

        // Setext underline changes current block to header
        if line.r#type == LineType::Setextunderline {
            if let Some(cb_off) = self.current_block {
                let blk = self.get_block_at(cb_off);
                blk.block_type = BlockType::H;
                blk.data = line.data;
                blk.flags |= types::BLOCK_SETEXT_HEADER;
            }
            // The underline is not a line of the block: a reference definition
            // at the end of it does not go on with the underline.
            self.end_current_block()?;
            *pivot_line = Line {
                r#type: LineType::Blank,
                ..Line::default()
            };
            return Ok(());
        }

        // Table underline
        if line.r#type == LineType::Tableunderline {
            if let Some(cb_off) = self.current_block {
                if self.current_block_lines.len() > 1 {
                    // GFM: table interrupts paragraph. Split: lines 0..N-2 stay as paragraph,
                    // last line becomes table header.
                    let last_line = self.current_block_lines[self.current_block_lines.len() - 1];
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
        *line_idx ^= 1;
        Ok(())
    }

    pub(crate) fn start_new_block(&mut self, line: &Line) -> Result<(), parser::Error> {
        let block_type: BlockType = match line.r#type {
            LineType::Hr => BlockType::Hr,
            LineType::Atxheader => BlockType::H,
            LineType::Fencedcode | LineType::Indentedcode => BlockType::Code,
            LineType::Html => BlockType::Html,
            LineType::Table | LineType::Tableunderline => BlockType::Table,
            _ => BlockType::P,
        };

        // Of a line of HTML, `data` are flags.
        let (flags, data) = match block_type {
            BlockType::Html => (line.data, 0),
            _ => (0, line.data),
        };
        let aligned = self.append_block_header(BlockHeader {
            block_type,
            _pad: [0; 3],
            flags,
            data,
            n_lines: 0,
        })?;

        self.current_block = Some(aligned);
        self.current_block_lines.clear();
        Ok(())
    }

    pub(crate) fn add_line_to_current_block(
        &mut self,
        line: &Line,
    ) -> Result<(), bun_alloc::AllocError> {
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

    pub(crate) fn end_current_block(&mut self) -> Result<(), parser::Error> {
        if let Some(cb_off) = self.current_block {
            // Capture the header fields, drop the &mut borrow, then access
            // other &self fields.
            let (is_setext, hdr_n_lines) = {
                let hdr = self.get_block_header_at(cb_off);
                (
                    hdr.block_type == BlockType::H && (hdr.flags & types::BLOCK_SETEXT_HEADER) != 0,
                    hdr.n_lines,
                )
            };
            if is_setext
                && hdr_n_lines > 0
                && self.current_block_lines.len() > 0
                && self.current_block_lines[0].beg < self.size
                && self.text[self.current_block_lines[0].beg as usize] == b'['
            {
                self.consume_ref_defs_from_current_block();
            }
            let hdr = self.get_block_header_at(cb_off);

            // All lines consumed (`current_block_is_only_ref_defs` keeps such a
            // block from becoming a heading)
            if is_setext && hdr.n_lines == 0 {
                hdr.flags |= types::BLOCK_REF_DEF_ONLY;
            }

            // Write accumulated lines to block_bytes
            // SAFETY: VerbatimLine is POD; reinterpret slice as bytes for serialization
            let line_bytes: &[u8] = unsafe {
                core::slice::from_raw_parts(
                    self.current_block_lines.as_ptr().cast::<u8>(),
                    self.current_block_lines.len() * size_of::<VerbatimLine>(),
                )
            };
            // The block's lines land in `block_bytes` too (12 bytes per
            // line), not just its header, so this growth needs the same cap.
            parser::check_block_bytes_len(self.block_bytes.len() + line_bytes.len())?;
            self.block_bytes.extend_from_slice(line_bytes);
            self.current_block = None;
        }
        Ok(())
    }

    /// Whether nothing of the current block is left once its reference
    /// definitions are taken away: then there is nothing for a line under it to
    /// make a heading of.
    fn current_block_is_only_ref_defs(&mut self) -> bool {
        let Some(first) = self.current_block_lines.first() else {
            return false;
        };
        if self.ch(first.beg) != b'[' {
            return false;
        }
        self.buffer.clear();
        for vline in &self.current_block_lines {
            if !self.buffer.is_empty() {
                self.buffer.push(b'\n');
            }
            self.buffer
                .extend_from_slice(&self.text[vline.beg as usize..vline.end as usize]);
        }
        let merged = core::mem::take(&mut self.buffer);
        let mut pos: usize = 0;
        while pos < merged.len() {
            match self.parse_ref_def(&merged, pos) {
                Some(result) if !self.normalize_label(result.label).is_empty() => {
                    pos = result.end_pos;
                }
                _ => break,
            }
        }
        let is_only_ref_defs = pos >= merged.len();
        self.buffer = merged;
        is_only_ref_defs
    }

    pub(crate) fn consume_ref_defs_from_current_block(&mut self) {
        if self.current_block_lines.is_empty() {
            return;
        }

        // Merge lines into buffer for ref def parsing
        self.buffer.clear();
        for idx in 0..self.current_block_lines.len() {
            let vline = self.current_block_lines[idx];
            if vline.beg > vline.end || vline.end > self.size {
                continue;
            }
            if self.buffer.len() > 0 {
                self.buffer.push(b'\n');
            }
            self.buffer
                .extend_from_slice(&self.text[vline.beg as usize..vline.end as usize]);
        }

        // Move the merged buffer out of self so parse_ref_def/normalize_label
        // can borrow &self/&mut self.
        let merged = core::mem::take(&mut self.buffer);
        let mut pos: usize = 0;
        let mut lines_consumed: u32 = 0;

        while pos < merged.len() {
            let Some(result) = self.parse_ref_def(&merged, pos) else {
                break;
            };

            // Capture borrowed result fields before &mut self calls.
            let raw_label: Box<[u8]> = Box::from(result.label);
            let dest_dupe: Box<[u8]> = Box::from(result.dest);
            let title_dupe: Box<[u8]> = Box::from(result.title);
            let end_pos = result.end_pos;

            let norm_label = self.normalize_label(&raw_label);
            if norm_label.is_empty() {
                break;
            }

            // First definition wins
            let label = norm_label.into_boxed_slice();
            if !self.ref_def_labels.contains(&label) {
                let _ = self.ref_def_labels.insert(&label);
                self.ref_defs.push(crate::ref_defs::RefDef {
                    dest: dest_dupe,
                    title: title_dupe,
                });
            }

            let mut newlines: u32 = 0;
            for &mc in &merged[pos..end_pos] {
                if mc == b'\n' {
                    newlines += 1;
                }
            }
            if end_pos >= merged.len() && (end_pos == pos || merged[end_pos - 1] != b'\n') {
                newlines += 1;
            }
            if self.track {
                let first = self.current_block_lines.get(lines_consumed as usize);
                let last = self
                    .current_block_lines
                    .get((lines_consumed + newlines).saturating_sub(1) as usize);
                if let (Some(first), Some(last)) = (first, last) {
                    self.renderer.ptr.definition(&types::Definition {
                        beg: first.beg,
                        end: last.end,
                        label: result.label,
                        dest: result.dest,
                        title: result.title,
                        lines: &self.current_block_lines
                            [lines_consumed as usize..(lines_consumed + newlines) as usize],
                    });
                }
            }
            lines_consumed += newlines;
            pos = end_pos;
        }

        // Restore buffer for reuse.
        self.buffer = merged;

        if lines_consumed > 0 {
            if let Some(cb_off) = self.current_block {
                let hdr_n_lines = self.get_block_header_at(cb_off).n_lines;
                if lines_consumed >= hdr_n_lines {
                    // All lines consumed
                    self.current_block_lines.clear();
                    self.get_block_header_at(cb_off).n_lines = 0;
                } else {
                    // Remove first lines_consumed lines
                    let total = self.current_block_lines.len();
                    let remaining = total - lines_consumed as usize;
                    // SAFETY: ranges overlap (src after dst); copy_within handles memmove semantics
                    self.current_block_lines
                        .copy_within(lines_consumed as usize..total, 0);
                    self.current_block_lines.truncate(remaining);
                    self.get_block_header_at(cb_off).n_lines = hdr_n_lines - lines_consumed;
                }
            }
        }
    }

    // get_block_header_at / get_block_at moved to parser.rs (shared by containers.rs).
}

use crate::types::LineType;
