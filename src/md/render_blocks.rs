

use super::helpers;
use super::parser::{Error as ParserError, Parser};
use super::types::{self, BlockType, TextType, VerbatimLine, OFF};

impl Parser {
    pub fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()> {
        if self.image_nesting_level > 0 {
            return Ok(());
        }
        self.renderer.enter_block(block_type, data, flags)
    }

    pub fn leave_block(&mut self, block_type: BlockType, data: u32) -> JsResult<()> {
        if self.image_nesting_level > 0 {
            return Ok(());
        }
        self.renderer.leave_block(block_type, data)
    }

    pub fn process_code_block(
        &mut self,
        block_lines: &[VerbatimLine],
        data: u32,
        flags: u32,
    ) -> JsResult<()> {
        let _ = data;

        let mut count = block_lines.len();

        // Trim trailing blank lines from indented code blocks (not fenced)
        if flags & types::BLOCK_FENCED_CODE == 0 {
            while count > 0 && block_lines[count - 1].beg >= block_lines[count - 1].end {
                count -= 1;
            }
        }

        for vline in &block_lines[0..count] {
            // Output indented content
            for _ in 0..vline.indent {
                self.emit_text(TextType::Normal, b" ")?;
            }
            let content = &self.text[vline.beg as usize..vline.end as usize];
            self.emit_text(TextType::Normal, content)?;
            self.emit_text(TextType::Normal, b"\n")?;
        }
        Ok(())
    }

    pub fn process_html_block(&mut self, block_lines: &[VerbatimLine]) -> JsResult<()> {
        for (i, vline) in block_lines.iter().enumerate() {
            if i > 0 {
                self.emit_text(TextType::Html, b"\n")?;
            }
            for _ in 0..vline.indent {
                self.emit_text(TextType::Html, b" ")?;
            }
            self.emit_text(
                TextType::Html,
                &self.text[vline.beg as usize..vline.end as usize],
            )?;
        }
        self.emit_text(TextType::Html, b"\n")?;
        Ok(())
    }

    pub fn process_table_block(
        &mut self,
        block_lines: &[VerbatimLine],
        col_count: u32,
    ) -> Result<(), ParserError> {
        if block_lines.len() < 2 {
            return Ok(());
        }

        // First line is header, second is underline, rest are body
        self.enter_block(BlockType::Thead, 0, 0)?;
        self.enter_block(BlockType::Tr, 0, 0)?;
        self.process_table_row(block_lines[0], true, col_count)?;
        self.leave_block(BlockType::Tr, 0)?;
        self.leave_block(BlockType::Thead, 0)?;

        if block_lines.len() > 2 {
            self.enter_block(BlockType::Tbody, 0, 0)?;
            for vline in &block_lines[2..] {
                self.enter_block(BlockType::Tr, 0, 0)?;
                self.process_table_row(*vline, false, col_count)?;
                self.leave_block(BlockType::Tr, 0)?;
            }
            self.leave_block(BlockType::Tbody, 0)?;
        }
        Ok(())
    }

    pub fn process_table_row(
        &mut self,
        vline: VerbatimLine,
        is_header: bool,
        col_count: u32,
    ) -> Result<(), ParserError> {
        let row_text = &self.text[vline.beg as usize..vline.end as usize];
        let mut start: usize = 0;
        let mut cell_index: u32 = 0;

        // Skip leading pipe
        if start < row_text.len() && row_text[start] == b'|' {
            start += 1;
        }

        while start < row_text.len() && cell_index < col_count {
            // Find cell end, skipping escaped chars and code spans
            let mut end = start;
            while end < row_text.len() && row_text[end] != b'|' {
                if row_text[end] == b'\\' && end + 1 < row_text.len() {
                    end += 2;
                } else {
                    end += 1;
                }
            }

            // Skip trailing pipe cell
            if end == row_text.len() && start == end {
                break;
            }

            // Trim cell content
            let mut cell_beg = start;
            let mut cell_end = end;
            while cell_beg < cell_end && helpers::is_blank(row_text[cell_beg]) {
                cell_beg += 1;
            }
            while cell_end > cell_beg && helpers::is_blank(row_text[cell_end - 1]) {
                cell_end -= 1;
            }

            let cell_type: BlockType = if is_header { BlockType::Th } else { BlockType::Td };
            let align_data: u32 = if cell_index < types::TABLE_MAXCOLCOUNT {
                self.table_alignments[cell_index as usize] as u32
            } else {
                0
            };
            self.enter_block(cell_type, align_data, 0)?;
            if cell_beg < cell_end {
                let cell_content = &row_text[cell_beg..cell_end];
                // GFM: \| in table cells should be consumed at the table level,
                // replacing \| with | before inline processing. This matters for
                // code spans where backslash escapes don't apply.
                if bun_str::strings::index_of(cell_content, b"\\|").is_some() {
                    let mut buf: Vec<u8> = Vec::new();
                    let unescaped: &[u8] = if buf.try_reserve(cell_content.len()).is_ok() {
                        let mut ci: usize = 0;
                        while ci < cell_content.len() {
                            if cell_content[ci] == b'\\'
                                && ci + 1 < cell_content.len()
                                && cell_content[ci + 1] == b'|'
                            {
                                // PERF(port): was appendAssumeCapacity
                                buf.push(b'|');
                                ci += 2;
                            } else {
                                // PERF(port): was appendAssumeCapacity
                                buf.push(cell_content[ci]);
                                ci += 1;
                            }
                        }
                        buf.as_slice()
                    } else {
                        cell_content
                    };
                    self.process_inline_content(
                        unescaped,
                        vline.beg + OFF::try_from(cell_beg).unwrap(),
                    )?;
                } else {
                    self.process_inline_content(
                        cell_content,
                        vline.beg + OFF::try_from(cell_beg).unwrap(),
                    )?;
                }
            }
            self.leave_block(cell_type, 0)?;
            cell_index += 1;

            if end < row_text.len() {
                start = end + 1; // skip |
            } else {
                break;
            }
        }

        // Pad short rows with empty cells
        let cell_type: BlockType = if is_header { BlockType::Th } else { BlockType::Td };
        while cell_index < col_count {
            let align_data: u32 = if cell_index < types::TABLE_MAXCOLCOUNT {
                self.table_alignments[cell_index as usize] as u32
            } else {
                0
            };
            self.enter_block(cell_type, align_data, 0)?;
            self.leave_block(cell_type, 0)?;
            cell_index += 1;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/md/render_blocks.zig (153 lines)
//   confidence: medium
//   todos:      0
//   notes:      TextType enum name guessed; row_text borrow of self.text may need reshaping for borrowck vs &mut self method calls
// ──────────────────────────────────────────────────────────────────────────
