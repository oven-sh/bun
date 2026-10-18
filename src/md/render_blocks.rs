use super::helpers;
use super::parser::{Error as ParserError, Parser};
use super::types::{self, BlockType, JsResult, OFF, TextType, VerbatimLine};

impl Parser<'_> {
    pub(crate) fn enter_block(
        &mut self,
        block_type: BlockType,
        data: u32,
        flags: u32,
    ) -> JsResult<()> {
        if self.image_nesting_level > 0 {
            return Ok(());
        }
        self.renderer.enter_block(block_type, data, flags)
    }

    pub(crate) fn leave_block(&mut self, block_type: BlockType, data: u32) -> JsResult<()> {
        if self.image_nesting_level > 0 {
            return Ok(());
        }
        self.renderer.leave_block(block_type, data)
    }

    pub(crate) fn process_code_block(
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

        self.emit_verbatim_lines(TextType::Normal, &block_lines[0..count])
    }

    pub(crate) fn process_html_block(&mut self, block_lines: &[VerbatimLine]) -> JsResult<()> {
        self.emit_verbatim_lines(TextType::Html, block_lines)
    }

    #[inline(always)]
    fn emit_verbatim_lines(&mut self, text_type: TextType, lines: &[VerbatimLine]) -> JsResult<()> {
        if self.indentation_as_spaces {
            return self.emit_verbatim_lines_in_columns(text_type, lines);
        }
        for vline in lines {
            let start = match vline.indent {
                0 => vline.beg,
                _ => self.emit_rest_of_tab(text_type, vline)?,
            };
            self.emit_text(text_type, &self.text[start as usize..vline.end as usize])?;
            self.emit_text(text_type, b"\n")?;
        }
        Ok(())
    }

    /// For `RendererImpl::wants_indentation_as_spaces`.
    #[inline(never)]
    fn emit_verbatim_lines_in_columns(
        &mut self,
        text_type: TextType,
        lines: &[VerbatimLine],
    ) -> JsResult<()> {
        for vline in lines {
            for _ in 0..vline.indent {
                self.emit_text(text_type, b" ")?;
            }
            self.emit_text(
                text_type,
                &self.text[vline.beg as usize..vline.end as usize],
            )?;
            self.emit_text(text_type, b"\n")?;
        }
        Ok(())
    }

    /// CommonMark 2.2: only what is left of a tab that the indentation of the block splits is made of spaces.
    #[inline(never)]
    fn emit_rest_of_tab(&mut self, text_type: TextType, vline: &VerbatimLine) -> JsResult<OFF> {
        const SPACES: &[u8] = b"   ";
        let floor = core::mem::replace(&mut self.verbatim_floor, vline.end);
        let (start, spaces) = helpers::indentation_start(self.text, vline.beg, vline.indent, floor);
        if spaces > 0 {
            self.emit_text(text_type, &SPACES[..(spaces as usize).min(SPACES.len())])?;
        }
        Ok(start)
    }

    pub(crate) fn process_table_block(
        &mut self,
        block_lines: &[VerbatimLine],
        col_count: u32,
    ) -> Result<(), ParserError> {
        if block_lines.len() < 2 {
            return Ok(());
        }

        // The alignments are those of the table that was analyzed last.
        let _ = self.is_table_underline(block_lines[1].beg);

        // First line is header, second is underline, rest are body
        self.enter_block(BlockType::Thead, 0, 0)?;
        self.tell_source(block_lines[0].beg, block_lines[0].end);
        self.enter_block(BlockType::Tr, 0, 0)?;
        self.process_table_row(block_lines[0], true, col_count)?;
        self.leave_block(BlockType::Tr, 0)?;
        self.leave_block(BlockType::Thead, 0)?;

        if block_lines.len() > 2 {
            self.enter_block(BlockType::Tbody, 0, 0)?;
            for vline in &block_lines[2..] {
                self.tell_source(vline.beg, vline.end);
                self.enter_block(BlockType::Tr, 0, 0)?;
                self.process_table_row(*vline, false, col_count)?;
                self.leave_block(BlockType::Tr, 0)?;
            }
            self.leave_block(BlockType::Tbody, 0)?;
        }
        Ok(())
    }

    fn tell_source(&mut self, beg: types::OFF, end: types::OFF) {
        if self.track {
            self.renderer.ptr.inline_source(beg, end);
        }
    }

    pub(crate) fn process_table_row(
        &mut self,
        vline: VerbatimLine,
        is_header: bool,
        col_count: u32,
    ) -> Result<(), ParserError> {
        let row_text = &self.text[vline.beg as usize..vline.end as usize];
        let blanks = row_text
            .iter()
            .rev()
            .take_while(|&&byte| helpers::is_blank(byte))
            .count();
        let row_text = &row_text[..row_text.len() - blanks];
        // Who wants to know what is written gets the cells that are written.
        let col_count = if self.track { u32::MAX } else { col_count };
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

            let cell_type: BlockType = if is_header {
                BlockType::Th
            } else {
                BlockType::Td
            };
            let align_data: u32 = if cell_index < types::TABLE_MAXCOLCOUNT {
                self.table_alignments[cell_index as usize] as u32
            } else {
                0
            };
            self.tell_source(vline.beg + start as u32, vline.beg + end as u32);
            self.enter_block(cell_type, align_data, 0)?;
            if cell_beg < cell_end {
                let cell_content = &row_text[cell_beg..cell_end];
                if self.track {
                    self.inline_lines.clear();
                    self.inline_line = 0;
                    self.inline_lines.push((0, vline.beg + cell_beg as u32));
                }
                // GFM: \| in table cells should be consumed at the table level,
                // replacing \| with | before inline processing. This matters for
                // code spans where backslash escapes don't apply.
                if !self.track && bun_core::strings::index_of(cell_content, b"\\|").is_some() {
                    let mut buf: Vec<u8> = Vec::new();
                    let unescaped: &[u8] = if buf.try_reserve(cell_content.len()).is_ok() {
                        let mut ci: usize = 0;
                        while ci < cell_content.len() {
                            if cell_content[ci] == b'\\'
                                && ci + 1 < cell_content.len()
                                && cell_content[ci + 1] == b'|'
                            {
                                buf.push(b'|');
                                ci += 2;
                            } else {
                                buf.push(cell_content[ci]);
                                ci += 1;
                            }
                        }
                        buf.as_slice()
                    } else {
                        cell_content
                    };
                    self.process_inline_content(unescaped)?;
                } else {
                    self.process_inline_content(cell_content)?;
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
        let cell_type: BlockType = if is_header {
            BlockType::Th
        } else {
            BlockType::Td
        };
        while !self.track && cell_index < col_count {
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
