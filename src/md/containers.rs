use bun_alloc::AllocError;

use crate::autolinks::is_list_bullet;
use crate::parser::{self, BlockHeader, Parser};
use crate::types::{self, BlockType, Container};

impl Parser<'_> {
    pub(crate) fn push_container(&mut self, c: &Container) -> Result<(), AllocError> {
        if (self.n_containers as usize) >= self.containers.len() {
            self.containers.push(*c);
        } else {
            self.containers[self.n_containers as usize] = *c;
        }

        self.n_containers += 1;
        Ok(())
    }

    pub(crate) fn push_container_bytes(
        &mut self,
        block_type: BlockType,
        data: u32,
        flags: u32,
    ) -> Result<(), parser::Error> {
        self.blocks.push(
            BlockHeader {
                block_type,
                flags,
                data,
                n_lines: 0,
            },
            &[],
        )
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

            // Emit container opener blocks
            if ch == b'>' {
                self.push_container_bytes(BlockType::Quote, 0, types::BLOCK_CONTAINER_OPENER)?;
            } else if ch == b'-' || ch == b'+' || ch == b'*' {
                // Save opener position for later loose-list patching
                self.containers[idx].opener_idx = self.blocks.next_idx();
                // Unordered list + list item
                self.push_container_bytes(BlockType::Ul, 0, types::BLOCK_CONTAINER_OPENER)?;
                self.push_container_bytes(
                    BlockType::Li,
                    if is_task {
                        u32::from(self.text[task_mark_off as usize])
                    } else {
                        0
                    },
                    types::BLOCK_CONTAINER_OPENER,
                )?;
            } else if ch == b'.' || ch == b')' {
                // Save opener position for later loose-list patching
                self.containers[idx].opener_idx = self.blocks.next_idx();
                // Ordered list + list item
                self.push_container_bytes(BlockType::Ol, start, types::BLOCK_CONTAINER_OPENER)?;
                self.push_container_bytes(
                    BlockType::Li,
                    if is_task {
                        u32::from(self.text[task_mark_off as usize])
                    } else {
                        0
                    },
                    types::BLOCK_CONTAINER_OPENER,
                )?;
            }
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn leave_child_containers(&mut self, keep: u32) -> Result<(), parser::Error> {
        while self.n_containers > keep {
            self.n_containers -= 1;
            // Capture the container fields before calling &mut self methods.
            let idx = self.n_containers as usize;
            let ch = self.containers[idx].ch;
            let is_loose = self.containers[idx].is_loose;
            let is_task = self.containers[idx].is_task;
            let task_mark_off = self.containers[idx].task_mark_off;
            let start = self.containers[idx].start;
            let opener_idx = self.containers[idx].opener_idx as usize;
            let loose_flag: u32 = if is_loose { types::BLOCK_LOOSE_LIST } else { 0 };

            // Emit container closer blocks
            if ch == b'>' {
                self.push_container_bytes(BlockType::Quote, 0, types::BLOCK_CONTAINER_CLOSER)?;
            } else if ch == b'-' || ch == b'+' || ch == b'*' {
                // Retroactively patch the opener with loose flag
                if is_loose {
                    self.blocks.headers[opener_idx].flags |= types::BLOCK_LOOSE_LIST;
                }
                self.push_container_bytes(
                    BlockType::Li,
                    if is_task {
                        u32::from(self.text[task_mark_off as usize])
                    } else {
                        0
                    },
                    types::BLOCK_CONTAINER_CLOSER,
                )?;
                self.push_container_bytes(
                    BlockType::Ul,
                    0,
                    types::BLOCK_CONTAINER_CLOSER | loose_flag,
                )?;
            } else if ch == b'.' || ch == b')' {
                // Retroactively patch the opener with loose flag
                if is_loose {
                    self.blocks.headers[opener_idx].flags |= types::BLOCK_LOOSE_LIST;
                }
                self.push_container_bytes(
                    BlockType::Li,
                    if is_task {
                        u32::from(self.text[task_mark_off as usize])
                    } else {
                        0
                    },
                    types::BLOCK_CONTAINER_CLOSER,
                )?;
                self.push_container_bytes(
                    BlockType::Ol,
                    start,
                    types::BLOCK_CONTAINER_CLOSER | loose_flag,
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
            return true;
        }
        // Bullet lists: different bullet chars are compatible
        if is_list_bullet(existing.ch) && is_list_bullet(new.ch) {
            return false;
        }
        false
    }

    pub(crate) fn process_all_blocks(&mut self) -> Result<(), parser::Error> {
        // Taken out so the loop can call `&mut self` methods; rendering is the list's last use.
        let blocks = core::mem::take(&mut self.blocks);

        // Reuse containers array for tight/loose tracking (same approach as md4c).
        // The containers are no longer needed for line analysis at this point.
        self.n_containers = 0;

        for (hdr, block_lines) in blocks.iter() {
            let block_type = hdr.block_type;
            let data = hdr.data;
            let flags = hdr.flags;

            // Handle container openers/closers
            if flags & types::BLOCK_CONTAINER_OPENER != 0 {
                self.enter_block(block_type, data, flags)?;
                // Track tight/loose state per container level (md4c approach)
                if block_type == BlockType::Ul || block_type == BlockType::Ol {
                    if (self.n_containers as usize) < self.containers.len() {
                        self.containers[self.n_containers as usize].is_loose =
                            flags & types::BLOCK_LOOSE_LIST != 0;
                        self.n_containers += 1;
                    }
                } else if block_type == BlockType::Quote {
                    // Blockquotes always act as "loose" — content inside blockquotes
                    // always gets <p> tags even when nested inside tight lists
                    if (self.n_containers as usize) < self.containers.len() {
                        self.containers[self.n_containers as usize].is_loose = true;
                        self.n_containers += 1;
                    }
                }
                continue;
            }
            if flags & types::BLOCK_CONTAINER_CLOSER != 0 {
                if block_type == BlockType::Ul
                    || block_type == BlockType::Ol
                    || block_type == BlockType::Quote
                {
                    if self.n_containers > 0 {
                        self.n_containers -= 1;
                    }
                }
                self.leave_block(block_type, data)?;
                continue;
            }

            // Skip paragraph blocks consumed entirely by ref defs
            if flags & types::BLOCK_REF_DEF_ONLY != 0 {
                continue;
            }

            // Determine if we're in a tight list (md4c approach: check innermost container)
            let is_in_tight_list = self.n_containers > 0
                && !self.containers[(self.n_containers - 1) as usize].is_loose;

            // Process leaf blocks — skip <p> enter/leave in tight lists
            if !is_in_tight_list || block_type != BlockType::P {
                self.enter_block(block_type, data, flags)?;
            }
            match block_type {
                BlockType::Hr => {}
                BlockType::Code => self.process_code_block(block_lines, data, flags)?,
                BlockType::Html => self.process_html_block(block_lines)?,
                BlockType::Table => self.process_table_block(block_lines, data)?,
                BlockType::P => self.process_leaf_block(block_lines, true)?,
                BlockType::H => self.process_leaf_block(block_lines, true)?,
                _ => self.process_leaf_block(block_lines, false)?,
            }
            if !is_in_tight_list || block_type != BlockType::P {
                self.leave_block(block_type, data)?;
            }
        }
        Ok(())
    }
}
