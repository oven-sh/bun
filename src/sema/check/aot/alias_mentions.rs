use crate::hir::TypeNodeId;
use crate::program::FileId;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

const NODES_PER_WORD: usize = 32;
const IS_KNOWN: u64 = 1;
const IS_KNOWN_TO_MENTION: u64 = 3;

pub struct AliasMentions {
    files: Box<[OnceLock<Box<[AtomicU64]>>]>,
}

struct BitPosition {
    word: usize,
    shift: usize,
}

impl AliasMentions {
    pub fn new(file_count: usize) -> AliasMentions {
        AliasMentions {
            files: (0..file_count).map(|_| OnceLock::new()).collect(),
        }
    }

    fn bit_position(node: TypeNodeId) -> BitPosition {
        let node = node.0 as usize;
        BitPosition {
            word: node / NODES_PER_WORD,
            shift: node % NODES_PER_WORD * 2,
        }
    }

    pub(super) fn get(&self, file: FileId, node: TypeNodeId) -> Option<bool> {
        let BitPosition { word, shift } = AliasMentions::bit_position(node);
        let words = self.files.get(file.idx())?.get()?;
        let known = words.get(word)?.load(Ordering::Relaxed) >> shift & IS_KNOWN_TO_MENTION;
        (known != 0).then_some(known == IS_KNOWN_TO_MENTION)
    }

    pub(super) fn note(
        &self,
        file: FileId,
        node: TypeNodeId,
        node_count: usize,
        mentions_alias: bool,
    ) {
        let Some(words) = self.files.get(file.idx()) else {
            return;
        };
        let words = words.get_or_init(|| {
            let words = (0..node_count.div_ceil(NODES_PER_WORD)).map(|_| AtomicU64::new(0));
            words.collect()
        });
        let BitPosition { word, shift } = AliasMentions::bit_position(node);
        let known = match mentions_alias {
            true => IS_KNOWN_TO_MENTION,
            false => IS_KNOWN,
        };
        if let Some(word) = words.get(word) {
            word.fetch_or(known << shift, Ordering::Relaxed);
        }
    }
}
