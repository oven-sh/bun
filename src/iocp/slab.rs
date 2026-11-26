use core::num::NonZeroU64;
use std::rc::Rc;

/// Identifies a [`Slab`] slot until the slot is released.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(transparent)]
pub(crate) struct Token(NonZeroU64);

impl Token {
    const NONZERO_BIT: NonZeroU64 = NonZeroU64::new(1 << 63).unwrap();
    const GENERATION_MASK: u32 = u32::MAX >> 1;
    /// Never set in `to_raw`.
    pub(crate) const SPARE_BIT: usize = 1 << 31;

    fn new(index: u32, generation: u32) -> Token {
        Token(Self::NONZERO_BIT | (u64::from(generation) << 32) | u64::from(index))
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

/// How many released values keep what they hold.
const WARM_COUNT: usize = 64;

/// Values have stable addresses and are reused after `release`.
pub(crate) struct Slab<T> {
    slots: Vec<Slot<T>>,
    /// Has capacity for every slot, so `release` does not allocate.
    free: Vec<u32>,
}

impl<T: Default> Slab<T> {
    pub(crate) const fn new() -> Self {
        Self {
            slots: Vec::new(),
            free: Vec::new(),
        }
    }

    /// A reused value may not be reset.
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
        let is_current = slot.is_used && token == Token::new(token.index() as u32, slot.generation);
        is_current.then_some(&slot.value)
    }

    pub(crate) fn release(&mut self, token: Token) {
        debug_assert!(self.get(token).is_some());
        let slot = &mut self.slots[token.index()];
        slot.is_used = false;
        slot.generation = (slot.generation + 1) & Token::GENERATION_MASK;
        self.free.push(token.index() as u32);
        if let Some(&index) = self.free.iter().nth_back(WARM_COUNT)
            && let Some(value) = Rc::get_mut(&mut self.slots[index as usize].value)
        {
            *value = T::default();
        }
    }

    /// Skips released slots.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (Token, &Rc<T>)> {
        (0..)
            .zip(&self.slots)
            .filter(|(_, slot)| slot.is_used)
            .map(|(index, slot)| (Token::new(index, slot.generation), &slot.value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::Cell;

    #[test]
    fn released_token_is_invalid() {
        let mut slab = Slab::<u8>::new();
        let (first, value) = slab.acquire();
        assert!(Rc::ptr_eq(slab.get(first).unwrap(), &value));
        slab.release(first);
        assert!(slab.get(first).is_none());

        let (second, reused) = slab.acquire();
        assert!(Rc::ptr_eq(&reused, &value));
        assert_ne!(first, second);
        assert!(slab.get(first).is_none());
        assert_eq!(slab.iter().count(), 1);
    }

    #[test]
    fn only_recently_released_values_keep_their_contents() {
        let mut slab = Slab::<Cell<bool>>::new();
        let tokens: Vec<_> = (0..WARM_COUNT * 2)
            .map(|_| {
                let (token, value) = slab.acquire();
                value.set(true);
                token
            })
            .collect();
        for token in tokens {
            slab.release(token);
        }
        let kept_count = (0..WARM_COUNT * 2)
            .filter(|_| slab.acquire().1.get())
            .count();
        assert_eq!(kept_count, WARM_COUNT);
    }
}
