use bun_alloc::AllocError;
use bun_collections::smallvec::SmallVec;

use crate::autolinks::is_list_bullet;
use crate::compat;
use crate::parser::{self, BlockHeader, Parser};
use crate::types::{self, BlockType, Container, ContainerEnds, OFF, VerbatimLine};

impl Parser<'_> {
    pub(crate) fn keeps_quotes(&self) -> bool {
        self.track || compat::tag_does_not_end_a_list(&self.flags)
    }

    /// How many containers are open up to the innermost `>`, with it.
    pub(crate) fn containers_up_to_quote(&self) -> u32 {
        self.quotes.last().map_or(0, |it| it + 1)
    }

    /// A line ends at `end` that is in the first `count` of the open containers. Their counts fall from the front to the back.
    pub(crate) fn set_container_ends(&mut self, count: u32, end: OFF) {
        while self
            .container_ends
            .pop_back_if(|it| it.count <= count)
            .is_some()
        {}
        if count > 0 {
            self.container_ends.push_back(ContainerEnds { count, end });
        }
    }

    /// Where the last line ends that is in the container at `index`. See `RendererImpl::container_source`.
    pub(crate) fn container_end(&self, index: u32) -> OFF {
        let said = self.container_ends.iter().take_while(|it| it.count > index);
        said.last().map_or(0, |it| it.end)
    }

    /// The same for the innermost container, which is left.
    fn take_container_end(&mut self, index: u32) -> OFF {
        let mut end = None;
        while let Some(said) = self.container_ends.pop_front_if(|it| it.count > index) {
            end = Some(said.end);
        }
        // It still holds for those further out of which nothing later is said.
        if let Some(end) = end
            && self
                .container_ends
                .front()
                .is_none_or(|it| it.count < index)
            && index > 0
        {
            self.container_ends
                .push_front(ContainerEnds { count: index, end });
        }
        end.unwrap_or(0)
    }

    pub(crate) fn push_container(&mut self, c: &Container) -> Result<(), AllocError> {
        if (self.n_containers as usize) >= self.containers.len() {
            self.containers.push(*c);
        } else {
            self.containers[self.n_containers as usize] = *c;
        }

        if c.ch == b':' {
            self.directives.push(self.n_containers);
        }
        if c.ch == b'>' && self.keeps_quotes() {
            self.quotes.push(self.n_containers);
        }

        self.n_containers += 1;
        Ok(())
    }

    pub(crate) fn push_container_block(
        &mut self,
        block_type: BlockType,
        data: u32,
        flags: u32,
        source: (OFF, OFF, u32),
    ) -> Result<(), parser::Error> {
        if self.track {
            self.container_sources.push(source);
        }
        self.append_block_header(BlockHeader {
            block_type,
            flags,
            data,
            n_lines: 0,
        })
    }

    pub(crate) fn enter_child_containers(&mut self, count: u32) -> Result<(), parser::Error> {
        let mut i: u32 = self.n_containers - count;
        while i < self.n_containers {
            // Capture the container fields before calling &mut self methods.
            let idx = i as usize;
            let ch = self.containers[idx].ch;
            let is_task = self.containers[idx].is_task;
            let task_mark_off = self.containers[idx].task_mark_off;
            let start = self.containers[idx].start;
            let mark = (
                self.containers[idx].mark_beg,
                self.containers[idx].mark_end,
                self.containers[idx].mark_indent,
            );

            self.containers[idx].opener_index = u32::try_from(self.blocks.len()).expect("int cast");

            // Emit container opener blocks
            if ch == b'>' {
                self.push_container_block(
                    BlockType::Quote,
                    0,
                    types::BLOCK_CONTAINER_OPENER,
                    mark,
                )?;
            } else if ch == b'^' {
                let label = self.normalize_label(
                    &self.text[mark.0 as usize + 2..(mark.1 as usize).saturating_sub(2)],
                );
                let _ = self.footnote_labels.insert(&label);
                self.push_container_block(
                    BlockType::Quote,
                    0,
                    types::BLOCK_CONTAINER_OPENER | types::BLOCK_FOOTNOTE,
                    mark,
                )?;
            } else if ch == b':' {
                self.push_container_block(
                    BlockType::Quote,
                    0,
                    types::BLOCK_CONTAINER_OPENER | types::BLOCK_DIRECTIVE,
                    mark,
                )?;
            } else if ch == b'-' || ch == b'+' || ch == b'*' {
                // Unordered list + list item
                self.push_container_block(BlockType::Ul, 0, types::BLOCK_CONTAINER_OPENER, mark)?;
                self.push_container_block(
                    BlockType::Li,
                    if is_task {
                        u32::from(self.text[task_mark_off as usize])
                    } else {
                        0
                    },
                    types::BLOCK_CONTAINER_OPENER,
                    mark,
                )?;
            } else if ch == b'.' || ch == b')' {
                // Ordered list + list item
                self.push_container_block(
                    BlockType::Ol,
                    start,
                    types::BLOCK_CONTAINER_OPENER,
                    mark,
                )?;
                self.push_container_block(
                    BlockType::Li,
                    if is_task {
                        u32::from(self.text[task_mark_off as usize])
                    } else {
                        0
                    },
                    types::BLOCK_CONTAINER_OPENER,
                    mark,
                )?;
            }
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn leave_child_containers(&mut self, keep: u32) -> Result<(), parser::Error> {
        while self.n_containers > keep {
            self.n_containers -= 1;
            self.directives.pop_if(|it| *it == self.n_containers);
            self.quotes.pop_if(|it| *it == self.n_containers);
            let container_end = self.take_container_end(self.n_containers);
            // Capture the container fields before calling &mut self methods.
            let idx = self.n_containers as usize;
            let ch = self.containers[idx].ch;
            let is_loose = self.containers[idx].is_loose;
            let is_task = self.containers[idx].is_task;
            let task_mark_off = self.containers[idx].task_mark_off;
            let start = self.containers[idx].start;
            let opener_index = self.containers[idx].opener_index as usize;
            let loose_flag: u32 = if is_loose { types::BLOCK_LOOSE_LIST } else { 0 };
            let is_ended_by_colons = self.is_directive_end && self.n_containers == keep;
            let end = (self.line_beg, container_end, u32::from(is_ended_by_colons));

            // Emit container closer blocks
            if ch == b'>' || ch == b'^' || ch == b':' {
                self.push_container_block(BlockType::Quote, 0, types::BLOCK_CONTAINER_CLOSER, end)?;
            } else if ch == b'-' || ch == b'+' || ch == b'*' {
                // Retroactively patch the opener with loose flag
                if is_loose && let Some(opener_hdr) = self.blocks.get_mut(opener_index) {
                    opener_hdr.flags |= types::BLOCK_LOOSE_LIST;
                }
                self.push_container_block(
                    BlockType::Li,
                    if is_task {
                        u32::from(self.text[task_mark_off as usize])
                    } else {
                        0
                    },
                    types::BLOCK_CONTAINER_CLOSER,
                    end,
                )?;
                self.push_container_block(
                    BlockType::Ul,
                    0,
                    types::BLOCK_CONTAINER_CLOSER | loose_flag,
                    end,
                )?;
            } else if ch == b'.' || ch == b')' {
                // Retroactively patch the opener with loose flag
                if is_loose && let Some(opener_hdr) = self.blocks.get_mut(opener_index) {
                    opener_hdr.flags |= types::BLOCK_LOOSE_LIST;
                }
                self.push_container_block(
                    BlockType::Li,
                    if is_task {
                        u32::from(self.text[task_mark_off as usize])
                    } else {
                        0
                    },
                    types::BLOCK_CONTAINER_CLOSER,
                    end,
                )?;
                self.push_container_block(
                    BlockType::Ol,
                    start,
                    types::BLOCK_CONTAINER_CLOSER | loose_flag,
                    end,
                )?;
            }
        }
        Ok(())
    }

    pub(crate) fn is_container_compatible(&self, existing: &Container, new: &Container) -> bool {
        let _ = self;
        // Same container type
        if existing.ch == b'>' && new.ch == b'>' {
            return true;
        }
        // Same list marker type
        if existing.ch == new.ch {
            return existing.ch != b'^' && existing.ch != b':';
        }
        // Bullet lists: different bullet chars are compatible
        if is_list_bullet(existing.ch) && is_list_bullet(new.ch) {
            return false;
        }
        false
    }

    /// Returns how many of `container_sources` are used up.
    pub(crate) fn process_blocks(
        &mut self,
        blocks: &[BlockHeader],
        lines: &[VerbatimLine],
    ) -> Result<usize, parser::Error> {
        // One for each list and block quote that the block is in
        let mut is_loose = SmallVec::<[bool; 32]>::new();
        let mut next = BlockPlace::default();

        while let Some(&BlockHeader {
            block_type,
            flags,
            data,
            n_lines,
        }) = blocks.get(next.block)
        {
            if block_type == BlockType::Li
                && flags & types::BLOCK_CONTAINER_OPENER != 0
                && self.reuse.is_some()
                && let Some(behind) = self.reuse_item(next, is_loose.last() == Some(&true))?
            {
                next = behind;
                continue;
            }

            let first_line = next.line;
            next.block += 1;
            next.line += n_lines as usize;
            let block_lines = &lines[first_line..next.line];

            if self.track
                && flags & (types::BLOCK_CONTAINER_OPENER | types::BLOCK_CONTAINER_CLOSER) != 0
            {
                if let Some(&(beg, end, indent)) = self.container_sources.get(next.container_source)
                {
                    self.renderer.ptr.container_source(beg, end, indent);
                }
                next.container_source += 1;
            }

            // Handle container openers/closers
            if flags & types::BLOCK_CONTAINER_OPENER != 0 {
                self.enter_block(block_type, data, flags)?;
                // Track tight/loose state per container level (md4c approach)
                if block_type == BlockType::Ul || block_type == BlockType::Ol {
                    is_loose.push(flags & types::BLOCK_LOOSE_LIST != 0);
                } else if block_type == BlockType::Quote {
                    // Blockquotes always act as "loose" — content inside blockquotes
                    // always gets <p> tags even when nested inside tight lists
                    is_loose.push(true);
                }
                continue;
            }
            if flags & types::BLOCK_CONTAINER_CLOSER != 0 {
                if block_type == BlockType::Ul
                    || block_type == BlockType::Ol
                    || block_type == BlockType::Quote
                {
                    is_loose.pop();
                }
                self.leave_block(block_type, data)?;
                if block_type == BlockType::Li && self.reuse.is_some() {
                    self.keep_item(next)?;
                }
                continue;
            }

            // Skip paragraph blocks consumed entirely by ref defs
            if flags & types::BLOCK_REF_DEF_ONLY != 0 {
                continue;
            }

            // Determine if we're in a tight list (md4c approach: check innermost container)
            let is_in_tight_list = !self.track && is_loose.last() == Some(&false);
            let is_read_by_consumer =
                self.track && self.renderer.ptr.leaf_source(block_type, block_lines);

            // Process leaf blocks — skip <p> enter/leave in tight lists
            if !is_in_tight_list || block_type != BlockType::P {
                self.enter_block(block_type, data, flags)?;
            }
            match block_type {
                _ if is_read_by_consumer => {}
                BlockType::Hr => {}
                BlockType::Code => self.process_code_block(block_lines, data, flags)?,
                BlockType::Html => self.process_html_block(block_lines)?,
                BlockType::Table => self.process_table_block(block_lines, first_line, data)?,
                BlockType::P if self.tracks_content => {
                    self.process_paragraph_as_written(block_lines)?
                }
                BlockType::P => self.process_leaf_block(block_lines, true)?,
                BlockType::H => {
                    if let Some(reuse) = &mut self.reuse {
                        reuse.n_headings += 1;
                    }
                    if self.tracks_content && flags & types::BLOCK_SETEXT_HEADER != 0 {
                        self.process_paragraph_as_written(block_lines)?
                    } else {
                        self.process_leaf_block(block_lines, true)?
                    }
                }
                _ => self.process_leaf_block(block_lines, false)?,
            }
            if !is_in_tight_list || block_type != BlockType::P {
                self.leave_block(block_type, data)?;
            }
        }
        Ok(next.container_source)
    }
}

/// An index in `Parser::blocks`, and those in `block_lines` and `container_sources` that go with it.
#[derive(Clone, Copy, Default)]
pub(crate) struct BlockPlace {
    pub(crate) block: usize,
    pub(crate) line: usize,
    pub(crate) container_source: usize,
}
