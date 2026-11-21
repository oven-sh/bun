use core::num::NonZeroU64;
use std::rc::Rc;

/// Names a slot of a [`Slab`] until that is released.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(transparent)]
pub(crate) struct Token(NonZeroU64);

impl Token {
    const MARK: NonZeroU64 = NonZeroU64::new(1 << 63).unwrap();
    const GENERATION_MASK: u32 = u32::MAX >> 1;
    /// Clear in `to_raw`.
    pub(crate) const SPARE_BIT: usize = 1 << 31;

    fn new(index: u32, generation: u32) -> Token {
        Token(Self::MARK | (u64::from(generation) << 32) | u64::from(index))
    }

    fn index(self) -> usize {
        self.0.get() as u32 as usize
    }

    pub(crate) fn from_raw(raw: usize) -> Option<Token> {
        NonZeroU64::new(raw as u64).map(Token)
    }

    pub(crate) fn to_raw(self) -> usize {
        self.0.get() as usize
    }
}

struct Slot<T> {
    value: Rc<T>,
    generation: u32,
    is_used: bool,
}

/// Values that never move and are used again once they are released.
pub(crate) struct Slab<T> {
    slots: Vec<Slot<T>>,
    /// Has room for every slot, so that `release` does not allocate.
    free: Vec<u32>,
}

impl<T: Default> Slab<T> {
    pub(crate) const fn new() -> Self {
        Self {
            slots: Vec::new(),
            free: Vec::new(),
        }
    }

    /// The value is as its last user left it.
    pub(crate) fn acquire(&mut self) -> (Token, Rc<T>) {
        let index = self.free.pop().unwrap_or_else(|| {
            assert!(self.slots.len() < Token::SPARE_BIT);
            let index = self.slots.len() as u32;
            self.slots.push(Slot {
                value: Rc::default(),
                generation: 0,
                is_used: false,
            });
            self.free.reserve(self.slots.len());
            index
        });
        let slot = &mut self.slots[index as usize];
        slot.is_used = true;
        (Token::new(index, slot.generation), Rc::clone(&slot.value))
    }

    pub(crate) fn get(&self, token: Token) -> Option<&Rc<T>> {
        let slot = self.slots.get(token.index())?;
        (slot.is_used && token == Token::new(token.index() as u32, slot.generation))
            .then_some(&slot.value)
    }

    pub(crate) fn release(&mut self, token: Token) {
        debug_assert!(self.get(token).is_some());
        let slot = &mut self.slots[token.index()];
        slot.is_used = false;
        slot.generation = (slot.generation + 1) & Token::GENERATION_MASK;
        self.free.push(token.index() as u32);
    }

    pub(crate) fn used(&self) -> impl Iterator<Item = (Token, &Rc<T>)> {
        let used = (0..).zip(&self.slots).filter(|(_, slot)| slot.is_used);
        used.map(|(index, slot)| (Token::new(index, slot.generation), &slot.value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_released_token_names_nothing() {
        let mut slab = Slab::<u8>::new();
        let (first, value) = slab.acquire();
        assert!(Rc::ptr_eq(slab.get(first).unwrap(), &value));
        slab.release(first);
        assert!(slab.get(first).is_none());

        let (second, reused) = slab.acquire();
        assert!(Rc::ptr_eq(&reused, &value));
        assert_ne!(first, second);
        assert!(slab.get(first).is_none());
        assert_eq!(slab.used().count(), 1);
    }
}
