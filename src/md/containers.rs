use core::mem::{align_of, size_of};

use bun_alloc::AllocError;

use crate::autolinks::is_list_bullet;
use crate::parser::{self, BlockHeader, Parser};
use crate::types::{self, BlockType, Container, VerbatimLine};

impl Parser<'_> {
    pub fn push_container(&mut self, c: &Container) -> Result<(), AllocError> {
        if (self.n_containers as usize) >= self.containers.len() {
            self.containers.push(*c);
            // PERF(port): Vec::push aborts on OOM; Zig returned error.OutOfMemory
        } else {
            self.containers[self.n_containers as usize] = *c;
        }

        // Record block_byte offset in the container
        let block_off: u32 = u32::try_from(self.block_bytes.len()).expect("int cast");
        self.containers[self.n_containers as usize].block_byte_off = block_off;

        self.n_containers += 1;
        Ok(())
    }

    pub fn push_container_bytes(
        &mut self,
        block_type: BlockType,
        data: u32,
        flags: u32,
    ) -> Result<(), AllocError> {
        let align_mask: usize = align_of::<BlockHeader>() - 1;
        let cur_len = self.block_bytes.len();
        let aligned = (cur_len + align_mask) & !align_mask;
        let needed = aligned + size_of::<BlockHeader>();
        self.block_bytes
            .reserve(needed.saturating_sub(self.block_bytes.len()));
        // Zero-fill to `needed`; bytes in [aligned, needed) are immediately
        // overwritten by the BlockHeader assignment below.
        self.block_bytes.resize(needed, 0);

        let hdr = self.get_block_header_at(aligned);
        *hdr = BlockHeader {
            block_type,
            _pad: [0; 3],
            flags,
            data,
            n_lines: 0,
        };
        Ok(())
    }

    pub fn enter_child_containers(&mut self, count: u32) -> Result<(), AllocError> {
        let mut i: u32 = self.n_containers - count;
        while i < self.n_containers {
            // PORT NOTE: reshaped for borrowck — capture container fields before
            // calling &mut self methods.
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
                let align_mask_: usize = align_of::<BlockHeader>() - 1;
                self.containers[idx].block_byte_off =
                    u32::try_from((self.block_bytes.len() + align_mask_) & !align_mask_).unwrap();
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
                let align_mask_: usize = align_of::<BlockHeader>() - 1;
                self.containers[idx].block_byte_off =
                    u32::try_from((self.block_bytes.len() + align_mask_) & !align_mask_).unwrap();
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

    pub fn leave_child_containers(&mut self, keep: u32) -> Result<(), AllocError> {
        while self.n_containers > keep {
            self.n_containers -= 1;
            // PORT NOTE: reshaped for borrowck — capture container fields before
            // calling &mut self methods.
            let idx = self.n_containers as usize;
            let ch = self.containers[idx].ch;
            let is_loose = self.containers[idx].is_loose;
            let is_task = self.containers[idx].is_task;
            let task_mark_off = self.containers[idx].task_mark_off;
            let start = self.containers[idx].start;
            let block_byte_off = self.containers[idx].block_byte_off;
            let loose_flag: u32 = if is_loose { types::BLOCK_LOOSE_LIST } else { 0 };

            // Emit container closer blocks
            if ch == b'>' {
                self.push_container_bytes(BlockType::Quote, 0, types::BLOCK_CONTAINER_CLOSER)?;
            } else if ch == b'-' || ch == b'+' || ch == b'*' {
                // Retroactively patch the opener with loose flag
                if is_loose && (block_byte_off as usize) < self.block_bytes.len() {
                    let opener_hdr = self.get_block_header_at(block_byte_off as usize);
                    opener_hdr.flags |= types::BLOCK_LOOSE_LIST;
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
                if is_loose && (block_byte_off as usize) < self.block_bytes.len() {
                    let opener_hdr = self.get_block_header_at(block_byte_off as usize);
                    opener_hdr.flags |= types::BLOCK_LOOSE_LIST;
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

    pub fn is_container_compatible(&self, existing: &Container, new: &Container) -> bool {
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

    pub fn process_all_blocks(&mut self) -> Result<(), parser::Error> {
        let mut off: usize = 0;
        // PORT NOTE: reshaped for borrowck — capture raw ptr/len so we can call
        // &mut self methods inside the loop. block_bytes is not mutated during
        // process_all_blocks.
        let bytes_len = self.block_bytes.len();
        let bytes_ptr = self.block_bytes.as_ptr();

        // Reuse containers array for tight/loose tracking (same approach as md4c).
        // The containers are no longer needed for line analysis at this point.
        self.n_containers = 0;

        while off < bytes_len {
            // Align to BlockHeader
            let align_mask: usize = align_of::<BlockHeader>() - 1;
            off = (off + align_mask) & !align_mask;
            if off + size_of::<BlockHeader>() > bytes_len {
                break;
            }

            // SAFETY: bytes_ptr+off is within bounds (checked above) and was written
            // at BlockHeader alignment by push_container_bytes / current_block writes.
            let hdr: &BlockHeader = unsafe { &*bytes_ptr.add(off).cast::<BlockHeader>() };
            off += size_of::<BlockHeader>();

            let block_type = hdr.block_type;
            let n_lines = hdr.n_lines;
            let data = hdr.data;
            let flags = hdr.flags;

            // Read lines after header
            let lines_size = (n_lines as usize) * size_of::<VerbatimLine>();
            if off + lines_size > bytes_len {
                break;
            }
            // SAFETY: bytes_ptr+off..+lines_size is within bounds (checked above) and
            // VerbatimLine entries were written contiguously after the header.
            let block_lines: &[VerbatimLine] = unsafe {
                core::slice::from_raw_parts(
                    bytes_ptr.add(off).cast::<VerbatimLine>(),
                    n_lines as usize,
                )
            };
            off += lines_size;

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

// ported from: src/md/containers.zig
