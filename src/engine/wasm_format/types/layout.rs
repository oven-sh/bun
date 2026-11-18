//! Where the fields of a struct go.

/// Places each field at its natural alignment, in padding if there is some. The place of a field depends only on
/// the fields before it, so a subtype has those of its supertype at the same offsets.
#[derive(Default)]
pub(super) struct StructLayout {
    end: u32,
    /// By the logarithm of the size: an aligned piece of padding. There is never more than one of a size.
    holes: [Option<u32>; 4],
}

impl StructLayout {
    pub(super) fn place(&mut self, log2_size: u8) -> u32 {
        let wanted = usize::from(log2_size);
        for found in wanted..self.holes.len() {
            if let Some(offset) = self.holes[found].take() {
                for rest in wanted..found {
                    self.holes[rest] = Some(offset + (1 << rest));
                }
                return offset;
            }
        }
        for smaller in 0..wanted {
            if self.end & (1 << smaller) != 0 {
                debug_assert!(self.holes[smaller].is_none());
                self.holes[smaller] = Some(self.end);
                self.end += 1 << smaller;
            }
        }
        let offset = self.end;
        self.end += 1 << wanted;
        offset
    }

    pub(super) fn size(&self) -> u32 {
        self.end.next_multiple_of(8)
    }
}
