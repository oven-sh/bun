use core::ptr::NonNull;

use crate::expr::Data;
use crate::{E, StoreRef};

/// Nodes and string bytes on the global heap, for values that outlive every arena and AST store.
#[derive(Default)]
pub struct OwnedValues {
    bytes: Vec<Box<[u8]>>,
    // The boxes are load-bearing: a `StoreRef` points into each, and a bare `Vec` moves its items when it grows.
    #[expect(clippy::vec_box)]
    strings: Vec<Box<E::EString>>,
}

/// The node keeps its address, and nothing writes to it through `list` before the drop.
fn keep<T>(list: &mut Vec<Box<T>>, node: T) -> StoreRef<T> {
    list.push(Box::new(node));
    let node: &mut T = list.last_mut().expect("pushed above");
    StoreRef::from(NonNull::from(node))
}

impl OwnedValues {
    /// A string node with its own copy of `bytes`.
    pub fn string(&mut self, bytes: &[u8]) -> Data {
        self.bytes.push(bytes.into());
        let node = E::EString::init(self.bytes.last().expect("pushed above"));
        Data::EString(keep(&mut self.strings, node))
    }

    /// About how many bytes the values take.
    pub fn memory_cost(&self) -> usize {
        self.bytes.iter().map(|bytes| bytes.len()).sum::<usize>()
            + self.bytes.capacity() * size_of::<Box<[u8]>>()
            + self.strings.len() * size_of::<E::EString>()
            + self.strings.capacity() * size_of::<Box<E::EString>>()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_string_stays_readable_while_more_are_added() {
        let mut values = OwnedValues::default();
        let texts: Vec<Vec<u8>> = (0..64).map(|i| vec![b'a' + (i % 26) as u8; i]).collect();
        let nodes: Vec<Data> = texts.iter().map(|text| values.string(text)).collect();
        for (node, text) in nodes.iter().zip(&texts) {
            let Data::EString(string) = node else {
                panic!("not a string");
            };
            assert_eq!(string.slice8(), text.as_slice());
        }
        let bytes: usize = texts.iter().map(Vec::len).sum();
        let slots = values.bytes.capacity() * size_of::<Box<[u8]>>()
            + values.strings.capacity() * size_of::<Box<E::EString>>();
        assert!(slots >= texts.len() * (size_of::<Box<[u8]>>() + size_of::<Box<E::EString>>()));
        assert_eq!(
            values.memory_cost(),
            bytes + texts.len() * size_of::<E::EString>() + slots
        );
    }
}
