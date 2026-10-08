//! The text of a paragraph, a heading or a table cell: its lines without what is before them in the
//! file (the markers of containers, indentation), joined by `\n`.

use super::block::Segment;

#[derive(Default)]
pub(crate) struct Content {
    pub(crate) bytes: Vec<u8>,
    /// For every line, where it starts here and where it starts in the file.
    lines: Vec<(u32, u32)>,
}

impl Content {
    pub(crate) fn fill(&mut self, text: &[u8], segments: &[Segment]) {
        self.bytes.clear();
        self.lines.clear();
        for (index, segment) in segments.iter().enumerate() {
            if index > 0 {
                self.bytes.push(b'\n');
            }
            self.lines.push((self.bytes.len() as u32, segment.start));
            self.bytes.extend_from_slice(
                text.get(segment.start as usize..segment.end as usize)
                    .unwrap_or_default(),
            );
        }
    }

    /// Where the character at `index` is in the file.
    pub(crate) fn source(&self, index: usize) -> u32 {
        let index = index as u32;
        let after = self.lines.partition_point(|line| line.0 <= index);
        match self.lines.get(after.saturating_sub(1)) {
            Some(&(start, source)) => source + (index - start),
            None => 0,
        }
    }

    /// Where something that ends before `index` ends in the file.
    pub(crate) fn source_end(&self, index: usize) -> u32 {
        match index {
            0 => self.source(0),
            _ => self.source(index - 1) + 1,
        }
    }

    /// The index of the line that `index` is on.
    pub(crate) fn line_of(&self, index: usize) -> usize {
        self.lines
            .partition_point(|line| line.0 <= index as u32)
            .saturating_sub(1)
    }
}
