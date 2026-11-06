use super::generated::ProgramList;

pub type ListCounts = [u64; ProgramList::COUNT];

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct WireSpan {
    pub first: u32,
    pub count: u32,
}

pub struct SectionWriter<'a> {
    words: [Vec<u32>; ProgramList::COUNT],
    counts: ListCounts,
    first_indices: ListCounts,
    blobs: Vec<&'a [u8]>,
}

impl<'a> SectionWriter<'a> {
    #[allow(clippy::large_types_passed_by_value)]
    pub fn new(first_indices: ListCounts) -> SectionWriter<'a> {
        SectionWriter {
            words: core::array::from_fn(|_| Vec::new()),
            counts: [0; ProgramList::COUNT],
            first_indices,
            blobs: Vec::new(),
        }
    }

    pub fn reserve(&mut self, list: ProgramList, word_count: usize) {
        self.words[list as usize].reserve(word_count);
    }

    pub fn next_index(&self, list: ProgramList) -> u32 {
        (self.first_indices[list as usize] + self.counts[list as usize]) as u32
    }

    pub fn push_records(&mut self, list: ProgramList, words: &[u32], count: usize) -> WireSpan {
        debug_assert!(list != ProgramList::Bytes);
        debug_assert_eq!(words.len() * 4, count * list.element_size());
        let first = self.next_index(list);
        self.words[list as usize].extend_from_slice(words);
        self.counts[list as usize] += count as u64;
        WireSpan {
            first,
            count: count as u32,
        }
    }

    pub fn push_bytes(&mut self, bytes: &'a [u8]) -> WireSpan {
        let first = self.next_index(ProgramList::Bytes);
        self.blobs.push(bytes);
        self.counts[ProgramList::Bytes as usize] += bytes.len() as u64;
        WireSpan {
            first,
            count: bytes.len() as u32,
        }
    }

    pub fn words_of(&self, list: ProgramList) -> &[u32] {
        &self.words[list as usize]
    }

    pub fn count_of(&self, list: ProgramList) -> u64 {
        self.counts[list as usize]
    }

    pub fn blobs(&self) -> &[&'a [u8]] {
        &self.blobs
    }
}
