use core::cell::Cell;
use core::hash::{Hash, Hasher};

use bun_engine_regexp::Flags;
use bun_engine_text::{StringImpl, StringRef};

use crate::heap::{Survivors, WeakValueMap};
use crate::vm::Root;
use crate::{Gc, RegExp, Visitor, Vm};

const RECENT_COUNT: usize = 64;
const MAX_RECENT_LENGTH: usize = 256;

type Key = (StringRef, u8);

struct Wanted<'a>(&'a StringImpl, u8);

impl Hash for Wanted<'_> {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        state.write_u32(self.0.hash());
        state.write_u8(self.1);
    }
}

impl hashbrown::Equivalent<Key> for Wanted<'_> {
    #[inline]
    fn equivalent(&self, key: &Key) -> bool {
        self.1 == key.1 && *self.0 == *key.0
    }
}

pub(super) struct Cache {
    all: WeakValueMap<Key, RegExp>,
    /// The last ones that were compiled stay alive.
    recent: [Root<RegExp>; RECENT_COUNT],
    next_recent: Cell<usize>,
}

impl Default for Cache {
    fn default() -> Cache {
        Cache {
            all: WeakValueMap::default(),
            recent: [const { Root::new() }; RECENT_COUNT],
            next_recent: Cell::new(0),
        }
    }
}

impl Cache {
    #[inline]
    pub(super) fn get(&self, vm: &Vm, pattern: &StringImpl, flags: Flags) -> Option<Gc<RegExp>> {
        self.all.get(vm, &Wanted(pattern, flags.bits()))
    }

    pub(super) fn insert(&self, regexp: Gc<RegExp>) {
        let key = (StringRef::retain(&regexp.pattern()), regexp.flags().bits());
        self.all.insert(key, regexp);
    }

    pub(super) fn keep(&self, regexp: &RegExp) {
        let last = (self.next_recent.get() + RECENT_COUNT - 1) % RECENT_COUNT;
        if self.recent[last].get() == Some(regexp.into()) {
            return;
        }
        if regexp.pattern().len() <= MAX_RECENT_LENGTH {
            self.recent[self.next_recent.get()].set(Some(regexp.into()));
            self.next_recent.update(|next| (next + 1) % RECENT_COUNT);
        }
    }

    pub(super) fn delete_code(&self, vm: &Vm) {
        self.recent.iter().for_each(|root| root.set(None));
        self.all.for_each_value(vm, |regexp| regexp.delete_code());
    }

    pub(super) fn visit(&self, visitor: &mut Visitor) {
        self.recent.iter().for_each(|root| root.visit(visitor));
    }

    pub(super) fn prune(&self, survivors: &Survivors) {
        self.all.prune(survivors);
    }
}
