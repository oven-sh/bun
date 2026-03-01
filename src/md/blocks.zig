pub fn processDoc(self: *Parser) Parser.Error!void {
    const dummy_blank = Line{ .type = .blank };
    var pivot_line = dummy_blank;
    var line_buf: [2]Line = .{ .{}, .{} };
    var line_idx: u1 = 0;
    var off: OFF = 0;

    try self.enterBlock(.doc, 0, 0);

    while (off < self.size) {
        const line = &line_buf[line_idx];

        try self.analyzeLine(off, &off, &pivot_line, line);
        try self.processLine(&pivot_line, line, &line_buf, &line_idx);
    }

    try self.endCurrentBlock();

    // Build ref def hashtable
    try self.buildRefDefHashtable();

    // Process all blocks
    try self.leaveChildContainers(0);
    try self.processAllBlocks();

    try self.leaveBlock(.doc, 0);
}

pub fn analyzeLine(self: *Parser, off_start: OFF, p_end: *OFF, pivot_line: *const Line, line: *Line) error{OutOfMemory}!void {
    var off = off_start;
    var total_indent: u32 = 0;
    var n_parents: u32 = 0;
    var n_brothers: u32 = 0;
    var n_children: u32 = 0;
    var container = Container{};
    const prev_line_has_list_loosening_effect = self.last_line_has_list_loosening_effect;

    line.* = .{};
    line.enforce_new_block = false;

    // Eat indentation and match containers
    const indent_result = helpers.lineIndentation(self.text, total_indent, off);
    line.indent = indent_result.indent;
    total_indent += line.indent;
    off = indent_result.off;
    line.beg = off;

    // Match existing containers
    // remaining_indent tracks the indent left after subtracting each matched
    // container's contents_indent. This ensures nested containers compare
    // against the correct relative indentation rather than the absolute column.
    var remaining_indent = total_indent;
    while (n_parents < self.n_containers) {
        const c = &self.containers.items[n_parents];
        if (c.ch == '>') {
            // Blockquote continuation
            if (off < self.size and self.text[off] == '>' and line.indent < self.code_indent_offset) {
                off += 1;
                total_indent += 1;
                const r = helpers.lineIndentation(self.text, total_indent, off);
                line.indent = r.indent;
                total_indent += line.indent;
                off = r.off;
                // The optional 1st space after '>' is part of the blockquote mark
                if (line.indent > 0) line.indent -= 1;
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
            if (remaining_indent >= c.contents_indent) {
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
    if (off >= self.size or helpers.isNewline(self.text[off])) {
        if (n_brothers + n_children == 0) {
            while (n_parents < self.n_containers and
                self.containers.items[n_parents].ch != '>')
            {
                n_parents += 1;
            }
        }
    }

    // Track effective pivot type — brother/child containers reset this to .blank
    var effective_pivot_type = pivot_line.type;

    // Determine line type
    while (true) {
        // Check for fenced code continuation/closing (BEFORE blank line check, like md4c)
        if (effective_pivot_type == .fencedcode) {
            line.beg = off;

            // Check for closing fence
            if (line.indent < self.code_indent_offset) {
                if (self.isClosingCodeFence(off, pivot_line.data)) {
                    line.type = .blank; // ending fence treated as blank
                    self.last_line_has_list_loosening_effect = false;
                    break;
                }
            }

            // Fenced code continuation only if all containers matched (md4c: n_parents == n_containers)
            if (n_parents == self.n_containers) {
                if (line.indent > self.fence_indent)
                    line.indent -= self.fence_indent
                else
                    line.indent = 0;
                line.type = .fencedcode;
                break;
            }
            // If containers don't match, fenced code is implicitly ended.
            // Fall through to other checks.
        }

        // Check for HTML block continuation (BEFORE blank line check, like md4c)
        if (effective_pivot_type == .html and self.html_block_type > 0) {
            if (n_parents < self.n_containers) {
                // HTML block is implicitly ended when enclosing container closes
                self.html_block_type = 0;
            } else {
                if (self.isHtmlBlockEndCondition(off, self.html_block_type)) {
                    // Save type before clearing (md4c uses a local variable)
                    const ended_type = self.html_block_type;
                    self.html_block_type = 0;

                    // Types 6 and 7 end conditions also serve as blank lines
                    if (ended_type == 6 or ended_type == 7) {
                        line.type = .blank;
                        line.indent = 0;
                        break;
                    }
                }
                line.type = .html;
                n_parents = self.n_containers;
                break;
            }
        }

        // Check for blank line
        if (off >= self.size or helpers.isNewline(self.text[off])) {
            // Indented code continuation through blank lines
            if (effective_pivot_type == .indentedcode and n_parents == self.n_containers) {
                line.type = .indentedcode;
                if (line.indent > self.code_indent_offset)
                    line.indent -= self.code_indent_offset
                else
                    line.indent = 0;
                self.last_line_has_list_loosening_effect = false;
            } else {
                line.type = .blank;
                self.last_line_has_list_loosening_effect = (n_parents > 0 and
                    n_brothers + n_children == 0 and
                    self.containers.items[n_parents - 1].ch != '>');

                // HTML block types 6 and 7 end on a blank line
                if (self.html_block_type >= 6) {
                    self.html_block_type = 0;
                }

                // md4c issue #6: Track empty list items that start with 2+ blank lines.
                // A list item can begin with at most one blank line.
                if (n_parents > 0 and self.containers.items[n_parents - 1].ch != '>' and
                    n_brothers + n_children == 0 and self.current_block == null and
                    self.block_bytes.items.len > @sizeOf(BlockHeader))
                {
                    const align_mask_: usize = @alignOf(BlockHeader) - 1;
                    const top_off = (self.block_bytes.items.len - @sizeOf(BlockHeader) + align_mask_) & ~align_mask_;
                    if (top_off + @sizeOf(BlockHeader) <= self.block_bytes.items.len) {
                        const top_hdr: *const BlockHeader = @ptrCast(@alignCast(self.block_bytes.items.ptr + (self.block_bytes.items.len - @sizeOf(BlockHeader))));
                        if (top_hdr.block_type == .li) {
                            self.last_list_item_starts_with_two_blank_lines = true;
                        }
                    }
                }
            }
            break;
        } else {
            // Non-blank line: check if we need to force-close an empty list item
            // (second half of md4c issue #6 hack)
            if (self.last_list_item_starts_with_two_blank_lines) {
                if (n_parents > 0 and n_parents == self.n_containers and
                    self.containers.items[n_parents - 1].ch != '>' and
                    n_brothers + n_children == 0 and self.current_block == null and
                    self.block_bytes.items.len > @sizeOf(BlockHeader))
                {
                    const top_hdr: *const BlockHeader = @ptrCast(@alignCast(self.block_bytes.items.ptr + (self.block_bytes.items.len - @sizeOf(BlockHeader))));
                    if (top_hdr.block_type == .li) {
                        n_parents -= 1;
                        line.indent = total_indent;
                        if (n_parents > 0)
                            line.indent -= @min(line.indent, self.containers.items[n_parents - 1].contents_indent);
                    }
                }
                self.last_list_item_starts_with_two_blank_lines = false;
            }
            self.last_line_has_list_loosening_effect = false;
        }

        // Indented code continuation
        if (effective_pivot_type == .indentedcode) {
            if (line.indent >= self.code_indent_offset) {
                line.type = .indentedcode;
                line.indent -= self.code_indent_offset;
                line.data = 0;
                break;
            }
        }

        // Check for Setext underline
        if (line.indent < self.code_indent_offset and effective_pivot_type == .text and
            off < self.size and (self.text[off] == '=' or self.text[off] == '-') and
            n_parents == self.n_containers)
        {
            const setext_result = self.isSetextUnderline(off);
            if (setext_result.is_setext) {
                line.type = .setextunderline;
                line.data = setext_result.level;
                break;
            }
        }

        // Check for thematic break
        if (line.indent < self.code_indent_offset and off < self.size and
            (self.text[off] == '-' or self.text[off] == '_' or self.text[off] == '*'))
        {
            if (self.isHrLine(off)) {
                line.type = .hr;
                break;
            }
        }

        // Check for brother container (another list item in same list)
        if (n_parents < self.n_containers and n_brothers + n_children == 0) {
            const cont_result = self.isContainerMark(line.indent, off);
            if (cont_result.is_container) {
                if (self.isContainerCompatible(&self.containers.items[n_parents], &cont_result.container)) {
                    effective_pivot_type = .blank;

                    container = cont_result.container;
                    off = cont_result.off;

                    total_indent += container.contents_indent - container.mark_indent;
                    const r = helpers.lineIndentation(self.text, total_indent, off);
                    line.indent = r.indent;
                    total_indent += line.indent;
                    off = r.off;
                    line.beg = off;

                    // Adjust whitespace belonging to mark
                    if (off >= self.size or helpers.isNewline(self.text[off])) {
                        container.contents_indent += 1;
                    } else if (line.indent <= self.code_indent_offset) {
                        container.contents_indent += line.indent;
                        line.indent = 0;
                    } else {
                        container.contents_indent += 1;
                        line.indent -= 1;
                    }

                    self.containers.items[n_parents].mark_indent = container.mark_indent;
                    self.containers.items[n_parents].contents_indent = container.contents_indent;

                    // HTML block ends when a new sibling container starts
                    self.html_block_type = 0;

                    n_brothers += 1;
                    continue;
                }
            }
        }

        // Check for indented code
        if (line.indent >= self.code_indent_offset and effective_pivot_type != .text) {
            line.type = .indentedcode;
            line.indent -= self.code_indent_offset;
            line.data = 0;
            break;
        }

        // Check for new container block
        if (line.indent < self.code_indent_offset) {
            const cont_result = self.isContainerMark(line.indent, off);
            if (cont_result.is_container) {
                container = cont_result.container;

                // List mark can't interrupt paragraph unless it's > or ordered starting at 1
                if (effective_pivot_type == .text and n_parents == self.n_containers) {
                    if ((cont_result.off >= self.size or helpers.isNewline(self.ch(cont_result.off))) and container.ch != '>') {
                        // Blank after list mark can't interrupt paragraph
                    } else if ((container.ch == '.' or container.ch == ')') and container.start != 1) {
                        // Ordered list with start != 1 can't interrupt paragraph
                    } else {
                        off = cont_result.off;
                        total_indent += container.contents_indent - container.mark_indent;
                        const r = helpers.lineIndentation(self.text, total_indent, off);
                        line.indent = r.indent;
                        total_indent += line.indent;
                        off = r.off;
                        line.beg = off;
                        line.data = container.ch;

                        if (off >= self.size or helpers.isNewline(self.text[off])) {
                            container.contents_indent += 1;
                        } else if (line.indent <= self.code_indent_offset) {
                            container.contents_indent += line.indent;
                            line.indent = 0;
                        } else {
                            container.contents_indent += 1;
                            line.indent -= 1;
                        }

                        if (n_brothers + n_children == 0) {
                            effective_pivot_type = .blank;
                        }

                        if (n_children == 0) {
                            try self.endCurrentBlock();
                            try self.leaveChildContainers(n_parents + n_brothers);
                        }

                        n_children += 1;
                        try self.pushContainer(&container);
                        continue;
                    }
                } else {
                    off = cont_result.off;
                    total_indent += container.contents_indent - container.mark_indent;
                    const r = helpers.lineIndentation(self.text, total_indent, off);
                    line.indent = r.indent;
                    total_indent += line.indent;
                    off = r.off;
                    line.beg = off;
                    line.data = container.ch;

                    if (off >= self.size or helpers.isNewline(self.text[off])) {
                        container.contents_indent += 1;
                    } else if (line.indent <= self.code_indent_offset) {
                        container.contents_indent += line.indent;
                        line.indent = 0;
                    } else {
                        container.contents_indent += 1;
                        line.indent -= 1;
                    }

                    if (n_brothers + n_children == 0) {
                        effective_pivot_type = .blank;
                    }

                    if (n_children == 0) {
                        try self.endCurrentBlock();
                        try self.leaveChildContainers(n_parents + n_brothers);
                    }

                    n_children += 1;
                    try self.pushContainer(&container);
                    continue;
                }
            }
        }

        // Check for table continuation
        if (effective_pivot_type == .table and n_parents == self.n_containers) {
            line.type = .table;
            break;
        }

        // Check for ATX header
        if (line.indent < self.code_indent_offset and off < self.size and self.text[off] == '#') {
            const atx_result = self.isAtxHeaderLine(off);
            if (atx_result.is_atx) {
                line.type = .atxheader;
                line.data = atx_result.level;
                line.beg = atx_result.content_beg;

                // Trim trailing whitespace
                while (line.end > line.beg and (helpers.isBlank(self.text[line.end - 1]) or self.text[line.end - 1] == '\t'))
                    line.end -= 1;
                // Trim optional closing # sequence
                if (line.end > line.beg and self.text[line.end - 1] == '#') {
                    var tmp = line.end;
                    while (tmp > line.beg and self.text[tmp - 1] == '#') tmp -= 1;
                    // The closing # must be preceded by space (or be the entire content)
                    if (tmp == line.beg or helpers.isBlank(self.text[tmp - 1])) {
                        line.end = tmp;
                        // Trim trailing whitespace again
                        while (line.end > line.beg and helpers.isBlank(self.text[line.end - 1]))
                            line.end -= 1;
                    }
                }

                break;
            }
        }

        // Check for opening code fence
        if (line.indent < self.code_indent_offset and off < self.size and
            (self.text[off] == '`' or self.text[off] == '~'))
        {
            const fence_result = self.isOpeningCodeFence(off);
            if (fence_result.is_fence) {
                line.type = .fencedcode;
                line.data = fence_result.fence_data;
                line.enforce_new_block = true;
                break;
            }
        }

        // Check for HTML block start
        if (off < self.size and self.text[off] == '<' and !self.flags.no_html_blocks) {
            self.html_block_type = self.isHtmlBlockStartCondition(off);

            // Type 7 can't interrupt paragraph
            if (self.html_block_type == 7 and effective_pivot_type == .text)
                self.html_block_type = 0;

            if (self.html_block_type > 0) {
                if (self.isHtmlBlockEndCondition(off, self.html_block_type)) {
                    self.html_block_type = 0;
                }
                line.enforce_new_block = true;
                line.type = .html;
                break;
            }
        }

        // Check for table underline
        if (self.flags.tables and effective_pivot_type == .text and
            off < self.size and (self.text[off] == '|' or self.text[off] == '-' or self.text[off] == ':') and
            n_parents == self.n_containers)
        {
            const tbl_result = self.isTableUnderline(off);
            if (tbl_result.is_underline and self.current_block != null and
                self.current_block_lines.items.len >= 1)
            {
                // GFM: validate that header row column count matches delimiter row column count.
                const header_line = self.current_block_lines.items[self.current_block_lines.items.len - 1];
                const header_cols = self.countTableRowColumns(header_line.beg, header_line.end);
                if (header_cols == tbl_result.col_count) {
                    line.data = tbl_result.col_count;
                    line.type = .tableunderline;
                    break;
                }
            }
        }

        // Default: normal text line
        line.type = .text;
        if (effective_pivot_type == .text and n_brothers + n_children == 0) {
            // Lazy continuation
            n_parents = self.n_containers;
        }

        // Check for task mark
        if (self.flags.tasklists and n_brothers + n_children > 0 and
            self.n_containers > 0 and
            isListItemMark(self.containers.items[self.n_containers - 1].ch))
        {
            var tmp = off;
            while (tmp < self.size and tmp < off + 3 and helpers.isBlank(self.text[tmp]))
                tmp += 1;
            if (tmp + 2 < self.size and self.text[tmp] == '[' and
                (self.text[tmp + 1] == 'x' or self.text[tmp + 1] == 'X' or self.text[tmp + 1] == ' ') and
                self.text[tmp + 2] == ']' and
                (tmp + 3 == self.size or helpers.isBlank(self.text[tmp + 3]) or helpers.isNewline(self.text[tmp + 3])))
            {
                const task_container = if (n_children > 0) &self.containers.items[self.n_containers - 1] else &container;
                task_container.is_task = true;
                task_container.task_mark_off = @intCast(tmp + 1);
                off = @intCast(tmp + 3);
                while (off < self.size and helpers.isWhitespace(self.text[off]))
                    off += 1;
                line.beg = off;
            }
        }

        break;
    }

    // Scan for end of line
    while (off < self.size and !helpers.isNewline(self.text[off]))
        off += 1;

    line.end = off;

    // Trim trailing closing marks for ATX header
    if (line.type == .atxheader) {
        var tmp = line.end;
        while (tmp > line.beg and helpers.isBlank(self.text[tmp - 1]))
            tmp -= 1;
        while (tmp > line.beg and self.text[tmp - 1] == '#')
            tmp -= 1;
        if (tmp == line.beg or helpers.isBlank(self.text[tmp - 1]) or self.flags.permissive_atx_headers)
            line.end = tmp;
    }

    // Trim trailing spaces (except for code/HTML/text)
    // Text lines keep trailing spaces for hard line break detection
    if (line.type != .indentedcode and line.type != .fencedcode and line.type != .html and line.type != .text) {
        while (line.end > line.beg and helpers.isBlank(self.text[line.end - 1]))
            line.end -= 1;
    }

    // Eat newline
    if (off < self.size and self.text[off] == '\r') off += 1;
    if (off < self.size and self.text[off] == '\n') off += 1;

    p_end.* = off;

    // Loose list detection
    if (prev_line_has_list_loosening_effect and line.type != .blank and n_parents + n_brothers > 0) {
        const ci = n_parents + n_brothers - 1;
        if (ci < self.containers.items.len and self.containers.items[ci].ch != '>') {
            self.containers.items[ci].is_loose = true;
        }
    }

    // Flush current leaf block before any container transitions
    // so that VerbatimLine data stays contiguous after its BlockHeader.
    if ((n_children == 0 and n_parents + n_brothers < self.n_containers) or n_brothers > 0 or n_children > 0) {
        try self.endCurrentBlock();
    }

    // Leave containers we're no longer part of
    if (n_children == 0 and n_parents + n_brothers < self.n_containers) {
        try self.leaveChildContainers(n_parents + n_brothers);
    }

    // Enter brother containers
    if (n_brothers > 0) {
        // Close old LI, open new LI
        try self.pushContainerBytes(.li, if (self.containers.items[n_parents].is_task) @as(u32, self.text[self.containers.items[n_parents].task_mark_off]) else 0, types.BLOCK_CONTAINER_CLOSER);
        try self.pushContainerBytes(.li, if (container.is_task) @as(u32, self.text[container.task_mark_off]) else 0, types.BLOCK_CONTAINER_OPENER);
        self.containers.items[n_parents].is_task = container.is_task;
        self.containers.items[n_parents].task_mark_off = container.task_mark_off;
    }

    if (n_children > 0) {
        try self.enterChildContainers(n_children);
    }
}

pub fn processLine(self: *Parser, pivot_line: *Line, line: *Line, line_buf: *[2]Line, line_idx: *u1) error{OutOfMemory}!void {
    // Blank line ends current leaf block.
    // Note: blank lines inside fenced code blocks are typed .fencedcode by analyzeLine,
    // and blank lines inside HTML blocks type 1-5 are typed .html by analyzeLine.
    // Only closing fences and actual block-ending blank lines reach here as .blank.
    if (line.type == .blank) {
        try self.endCurrentBlock();
        pivot_line.* = .{ .type = .blank };
        return;
    }

    // Opening code fence: start block but don't include fence line as content
    if (line.type == .fencedcode and line.enforce_new_block) {
        try self.endCurrentBlock();
        try self.startNewBlock(line);
        self.fence_indent = line.indent;

        // Extract info string position and store in block data
        if (self.current_block) |cb_off| {
            const hdr = self.getBlockHeaderAt(cb_off);
            const fence_count = line.data >> 8;
            var info_beg: OFF = line.beg + fence_count;
            // Skip whitespace before info string
            while (info_beg < line.end and helpers.isBlank(self.text[info_beg])) info_beg += 1;
            hdr.data = info_beg;
            hdr.flags |= types.BLOCK_FENCED_CODE;
        }
        pivot_line.* = line.*;
        return;
    }

    if (line.enforce_new_block)
        try self.endCurrentBlock();

    // Single-line blocks
    if (line.type == .hr or line.type == .atxheader) {
        try self.endCurrentBlock();
        try self.startNewBlock(line);
        try self.addLineToCurrentBlock(line);
        try self.endCurrentBlock();
        pivot_line.* = .{ .type = .blank };
        return;
    }

    // Setext underline changes current block to header
    if (line.type == .setextunderline) {
        if (self.current_block) |cb_off| {
            var blk = self.getBlockAt(cb_off);
            blk.block_type = .h;
            blk.data = line.data;
            blk.flags |= types.BLOCK_SETEXT_HEADER;
        }
        // Add the underline line (md4c stores it for ref def interaction)
        try self.addLineToCurrentBlock(line);
        try self.endCurrentBlock();
        if (self.current_block == null) {
            // Block was closed normally
            pivot_line.* = .{ .type = .blank };
        } else {
            // Block stayed open: all body was consumed as link ref defs,
            // underline downgraded to start of a new paragraph (md4c behavior)
            line.type = .text;
            pivot_line.* = line.*;
        }
        return;
    }

    // Table underline
    if (line.type == .tableunderline) {
        if (self.current_block) |cb_off| {
            if (self.current_block_lines.items.len > 1) {
                // GFM: table interrupts paragraph. Split: lines 0..N-2 stay as paragraph,
                // last line becomes table header.
                const last_line = self.current_block_lines.items[self.current_block_lines.items.len - 1];
                // Remove the last line from current paragraph block
                _ = self.current_block_lines.pop();
                var hdr = self.getBlockHeaderAt(cb_off);
                hdr.n_lines -= 1;
                // End the paragraph
                try self.endCurrentBlock();
                // Start a new table block with the saved header line
                var header_as_line = Line{
                    .type = .table,
                    .beg = last_line.beg,
                    .end = last_line.end,
                    .indent = last_line.indent,
                    .data = line.data,
                };
                try self.startNewBlock(&header_as_line);
                try self.addLineToCurrentBlock(&header_as_line);
            } else {
                // Single line paragraph: convert directly to table
                var blk = self.getBlockAt(cb_off);
                blk.block_type = .table;
                blk.data = line.data;
            }
        }
        // Change pivot to table
        pivot_line.type = .table;
        try self.addLineToCurrentBlock(line);
        return;
    }

    // Different line type ends current block
    if (line.type != pivot_line.type) {
        try self.endCurrentBlock();
    }

    // Start new block if needed
    if (self.current_block == null) {
        try self.startNewBlock(line);
        pivot_line.* = line.*;
    }

    // Add line to current block
    try self.addLineToCurrentBlock(line);

    // Ensure we alternate line buffers to avoid aliasing
    _ = line_buf;
    line_idx.* ^= 1;
}

pub fn startNewBlock(self: *Parser, line: *const Line) error{OutOfMemory}!void {
    const block_type: BlockType = switch (line.type) {
        .hr => .hr,
        .atxheader => .h,
        .fencedcode, .indentedcode => .code,
        .html => .html,
        .table, .tableunderline => .table,
        else => .p,
    };

    // Align block_bytes for Block alignment
    const align_mask: usize = @alignOf(BlockHeader) - 1;
    const cur_len = self.block_bytes.items.len;
    const aligned = (cur_len + align_mask) & ~align_mask;
    const needed = aligned + @sizeOf(BlockHeader);
    try self.block_bytes.ensureTotalCapacity(self.allocator, needed);
    // Zero-pad
    while (self.block_bytes.items.len < aligned) {
        try self.block_bytes.append(self.allocator, 0);
    }
    self.block_bytes.items.len = needed;

    const hdr = self.getBlockHeaderAt(aligned);
    hdr.* = .{
        .block_type = block_type,
        .flags = 0,
        .data = line.data,
        .n_lines = 0,
    };

    self.current_block = aligned;
    self.current_block_lines.clearRetainingCapacity();
}

pub fn addLineToCurrentBlock(self: *Parser, line: *const Line) error{OutOfMemory}!void {
    if (self.current_block) |cb_off| {
        const hdr = self.getBlockHeaderAt(cb_off);
        hdr.n_lines += 1;
        try self.current_block_lines.append(self.allocator, .{
            .beg = line.beg,
            .end = line.end,
            .indent = line.indent,
        });
    }
}

pub fn endCurrentBlock(self: *Parser) error{OutOfMemory}!void {
    if (self.current_block) |cb_off| {
        var hdr = self.getBlockHeaderAt(cb_off);

        // Consume link ref defs from setext headings (md4c: md_end_current_block).
        // For regular paragraphs, ref defs are consumed in buildRefDefHashtable.
        const is_setext = hdr.block_type == .h and (hdr.flags & types.BLOCK_SETEXT_HEADER) != 0;
        if (is_setext and hdr.n_lines > 0 and
            self.current_block_lines.items.len > 0 and
            self.current_block_lines.items[0].beg < self.size and
            self.text[self.current_block_lines.items[0].beg] == '[')
        {
            self.consumeRefDefsFromCurrentBlock();
            hdr = self.getBlockHeaderAt(cb_off);
        }

        // Handle setext heading after ref def consumption
        if (hdr.block_type == .h and (hdr.flags & types.BLOCK_SETEXT_HEADER) != 0) {
            if (hdr.n_lines > 1) {
                // Remove the underline (last line)
                hdr.n_lines -= 1;
                _ = self.current_block_lines.pop();
            } else if (hdr.n_lines == 1) {
                // Only underline left after eating ref defs → convert to paragraph,
                // keep block open so subsequent lines join this paragraph (md4c behavior)
                hdr.block_type = .p;
                hdr.flags &= ~@as(u32, types.BLOCK_SETEXT_HEADER);
                return; // Don't close the block!
            } else {
                // All lines consumed (shouldn't normally happen)
                hdr.flags |= types.BLOCK_REF_DEF_ONLY;
            }
        }

        // Write accumulated lines to block_bytes
        const line_bytes = std.mem.sliceAsBytes(self.current_block_lines.items);
        try self.block_bytes.appendSlice(self.allocator, line_bytes);
        self.current_block = null;
    }
}

pub fn consumeRefDefsFromCurrentBlock(self: *Parser) void {
    const items = self.current_block_lines.items;
    if (items.len == 0) return;

    // Merge lines into buffer for ref def parsing
    self.buffer.clearRetainingCapacity();
    for (items) |vline| {
        if (vline.beg > vline.end or vline.end > self.size) continue;
        if (self.buffer.items.len > 0) {
            self.buffer.append(self.allocator, '\n') catch {};
        }
        self.buffer.appendSlice(self.allocator, self.text[vline.beg..vline.end]) catch {};
    }

    const merged = self.buffer.items;
    var pos: usize = 0;
    var lines_consumed: u32 = 0;

    while (pos < merged.len) {
        const result = self.parseRefDef(merged, pos) orelse break;

        const norm_label = self.normalizeLabel(result.label);
        if (norm_label.len == 0) break;

        // First definition wins
        var already_exists = false;
        for (self.ref_defs.items) |existing| {
            if (std.mem.eql(u8, existing.label, norm_label)) {
                already_exists = true;
                break;
            }
        }
        if (!already_exists) {
            const dest_dupe = self.allocator.dupe(u8, result.dest) catch return;
            const title_dupe = self.allocator.dupe(u8, result.title) catch return;
            self.ref_defs.append(self.allocator, .{
                .label = norm_label,
                .dest = dest_dupe,
                .title = title_dupe,
            }) catch return;
        }

        var newlines: u32 = 0;
        for (merged[pos..result.end_pos]) |mc| {
            if (mc == '\n') newlines += 1;
        }
        if (result.end_pos >= merged.len and (result.end_pos == pos or merged[result.end_pos - 1] != '\n')) {
            newlines += 1;
        }
        lines_consumed += newlines;
        pos = result.end_pos;
    }

    if (lines_consumed > 0) {
        if (self.current_block) |cb_off| {
            var hdr = self.getBlockHeaderAt(cb_off);
            if (lines_consumed >= hdr.n_lines) {
                // All lines consumed
                self.current_block_lines.clearRetainingCapacity();
                hdr.n_lines = 0;
            } else {
                // Remove first lines_consumed lines
                const remaining = items.len - lines_consumed;
                std.mem.copyForwards(VerbatimLine, items[0..remaining], items[lines_consumed..]);
                self.current_block_lines.shrinkRetainingCapacity(remaining);
                hdr.n_lines -= lines_consumed;
            }
        }
    }
}

pub fn getBlockHeaderAt(self: *Parser, off: usize) *BlockHeader {
    return @ptrCast(@alignCast(self.block_bytes.items.ptr + off));
}

pub fn getBlockAt(self: *Parser, off: usize) *BlockHeader {
    return self.getBlockHeaderAt(off);
}

const helpers = @import("./helpers.zig");
const parser_mod = @import("./parser.zig");
const std = @import("std");

const autolinks_mod = @import("./autolinks.zig");
const isListItemMark = autolinks_mod.isListItemMark;

const Parser = parser_mod.Parser;
const BlockHeader = Parser.BlockHeader;

const types = @import("./types.zig");
const Align = types.Align;
const BlockType = types.BlockType;
const Container = types.Container;
const Line = types.Line;
const OFF = types.OFF;
const VerbatimLine = types.VerbatimLine;
