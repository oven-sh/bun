//! The syntax tree lives in one arena of numbers. A node is an offset into it.
//!
//!   N[n + 0]  kind (8 bits) | flags (16 bits) | operator or sub-kind (8 bits)
//!   N[n + 1]  start   offset into the text buffer
//!   N[n + 2]  end     offset into the text buffer (what Prettier calls locEnd)
//!   N[n + 3]  parent
//!   N[n + 4..] fields: first the single children, then the lists, then plain numbers
//!
//! A list is an offset too: N[l] is the length and N[l + 1 + i] the i-th item. Offset 0 holds a 0, so 0 is at once
//! "no node" and "the empty list". Children are made before their parents, so a subtree is contiguous memory.
//!
//! What a kind or a flag means is the business of each language. The arena only grows while a file is formatted: a
//! language that is embedded in another one appends its tree behind the host's.

use crate::{LARGEST, Numbers, Quick, Words, grow, why, zeros};

pub(crate) struct Arena {
    pub(crate) n_pos: i32,
    pub(crate) n_cap: i32,
    // ---- lists are collected on a side stack while their items are parsed
    pub(crate) ls: Vec<i32>,
    pub(crate) ls_pos: i32,
}
impl Arena {
    pub(crate) fn new() -> Self {
        Self {
            n_pos: 8,
            n_cap: 65536,
            ls: zeros(4096),
            ls_pos: 0,
        }
    }
}

pub(crate) const SUB_SHIFT: i32 = 24;
/// So many words stand behind the arena, for those who read or write a few words at once where fewer may be meant.
pub(crate) const SPARE: i32 = 8;
impl Quick {
    pub(crate) fn reset_ast(&mut self, expected_words: i32) {
        // (Some words more: the parsers ask for what they expect once more, on top of the few words that are taken by then. And at least twice what there was:
        // memory that is not written to costs nothing, a new array for every file that is larger than all before it does.)
        if (expected_words + 64).min(LARGEST) > self.arena.n_cap {
            self.arena.n_pos = 0;
            self.grow_ast((expected_words + 64).min(LARGEST));
        }
        self.n.put(0, 0);
        self.n.put(1, 0);
        self.n.put(2, 0);
        self.n.put(3, 0);
        self.arena.n_pos = 8;
        self.arena.ls_pos = 0;
    }

    #[cold]
    #[inline(never)]
    pub(crate) extern "rust-cold" fn grow_ast(&mut self, need: i32) {
        if grow(&mut self.n, self.arena.n_pos, need, SPARE) {
            self.arena.n_cap = self.n.len() as i32 - SPARE;
        } else {
            self.end_run(why::TOO_LARGE);
        }
    }

    pub(crate) fn reserve_ast(&mut self, words: i32) {
        if self.arena.n_pos + words > self.arena.n_cap {
            self.grow_ast(self.arena.n_pos + words);
        }
    }

    /// Forgets the nodes that were made since n_pos was `mark`. Nobody may know them.
    pub(crate) fn truncate_ast(&mut self, mark: i32) {
        self.arena.n_pos = mark;
    }

    /// Takes `words` words of the arena, for a node or a record whose layout is the caller's business. They are not cleared.
    pub(crate) fn alloc_ast(&mut self, words: i32) -> i32 {
        let n = self.arena.n_pos;
        if n + words > self.arena.n_cap {
            self.grow_ast(n + words);
        }
        self.arena.n_pos = n + words;
        return n;
    }

    // ---- making nodes. `head` is kind | flags | sub << 24.
    // A child learns its parent here. `a[0 + 3]` is scratch, so a missing child needs no test. A node that is thrown away
    // later (the call in `async (x) => y`) is older than the node that takes its children over, so the last store wins.
    pub(crate) fn alloc(&mut self, head: i32, start: i32, end: i32, size: i32) -> i32 {
        let n = self.arena.n_pos;
        if n + size > self.arena.n_cap {
            self.grow_ast(n + size);
        }
        self.n.put_several(n, [head, start, end, 0]);
        self.arena.n_pos = n + size;
        return n;
    }

    /// A node of so many words.
    #[inline(always)]
    fn alloc_several<const COUNT: usize>(&mut self, words: [i32; COUNT]) -> i32 {
        let n = self.arena.n_pos;
        if n + COUNT as i32 > self.arena.n_cap {
            self.grow_ast(n + COUNT as i32);
        }
        self.n.put_several(n, words);
        self.arena.n_pos = n + COUNT as i32;
        n
    }

    #[inline]
    pub(crate) fn arena_adopt(&mut self, l: i32, n: i32) {
        // Most lists are short: the first three items without a loop. (Where there are fewer, the first one is told twice.)
        let [count, a, b, c] = self.n.several(l);
        if count == 0 {
            return;
        }
        self.n.put(a + 3, n);
        self.n.put((if count > 1 { b } else { a }) + 3, n);
        self.n.put((if count > 2 { c } else { a }) + 3, n);
        let mut i: i32 = 4;
        while i <= count {
            self.n.put(self.n.at(l + i) + 3, n);
            i += 1;
        }
    }

    pub(crate) fn node0(&mut self, head: i32, start: i32, end: i32) -> i32 {
        return self.alloc(head, start, end, 4);
    }

    /// A node with `fields` words behind its four, for a language that lays its nodes out in another way (fields in source
    /// order, word 3 for something else than the parent). The caller fills the fields: they hold what was there before.
    pub(crate) fn node_raw(&mut self, head: i32, start: i32, end: i32, fields: i32) -> i32 {
        return self.alloc(head, start, end, 4 + fields);
    }

    pub(crate) fn node1(&mut self, head: i32, start: i32, end: i32, c0: i32) -> i32 {
        let n = self.alloc_several([head, start, end, 0, c0]);
        self.n.put(c0 + 3, n);
        return n;
    }

    pub(crate) fn node2(&mut self, head: i32, start: i32, end: i32, c0: i32, c1: i32) -> i32 {
        let n = self.alloc_several([head, start, end, 0, c0, c1]);
        self.n.put(c0 + 3, n);
        self.n.put(c1 + 3, n);
        return n;
    }

    pub(crate) fn node3(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        c0: i32,
        c1: i32,
        c2: i32,
    ) -> i32 {
        let n = self.alloc_several([head, start, end, 0, c0, c1, c2]);
        self.n.put(c0 + 3, n);
        self.n.put(c1 + 3, n);
        self.n.put(c2 + 3, n);
        return n;
    }

    pub(crate) fn node4(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        c0: i32,
        c1: i32,
        c2: i32,
        c3: i32,
    ) -> i32 {
        let n = self.alloc_several([head, start, end, 0, c0, c1, c2, c3]);
        self.n.put(c0 + 3, n);
        self.n.put(c1 + 3, n);
        self.n.put(c2 + 3, n);
        self.n.put(c3 + 3, n);
        return n;
    }

    pub(crate) fn node_l(&mut self, head: i32, start: i32, end: i32, l0: i32) -> i32 {
        let n = self.alloc_several([head, start, end, 0, l0]);
        self.arena_adopt(l0, n);
        return n;
    }

    pub(crate) fn node_ll(&mut self, head: i32, start: i32, end: i32, l0: i32, l1: i32) -> i32 {
        let n = self.alloc_several([head, start, end, 0, l0, l1]);
        self.arena_adopt(l0, n);
        self.arena_adopt(l1, n);
        return n;
    }

    pub(crate) fn node1_l(&mut self, head: i32, start: i32, end: i32, c0: i32, l0: i32) -> i32 {
        let n = self.alloc_several([head, start, end, 0, c0, l0]);
        self.n.put(c0 + 3, n);
        self.arena_adopt(l0, n);
        return n;
    }

    pub(crate) fn node1_ll(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        c0: i32,
        l0: i32,
        l1: i32,
    ) -> i32 {
        let n = self.alloc_several([head, start, end, 0, c0, l0, l1]);
        self.n.put(c0 + 3, n);
        self.arena_adopt(l0, n);
        self.arena_adopt(l1, n);
        return n;
    }

    pub(crate) fn node2_l(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        c0: i32,
        c1: i32,
        l0: i32,
    ) -> i32 {
        let n = self.alloc_several([head, start, end, 0, c0, c1, l0]);
        self.n.put(c0 + 3, n);
        self.n.put(c1 + 3, n);
        self.arena_adopt(l0, n);
        return n;
    }

    pub(crate) fn node2_ll(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        c0: i32,
        c1: i32,
        l0: i32,
        l1: i32,
    ) -> i32 {
        let n = self.alloc_several([head, start, end, 0, c0, c1, l0, l1]);
        self.n.put(c0 + 3, n);
        self.n.put(c1 + 3, n);
        self.arena_adopt(l0, n);
        self.arena_adopt(l1, n);
        return n;
    }

    #[inline]
    pub(crate) fn list_push(&mut self, item: i32) {
        if self.arena.ls_pos + 4 > (self.arena.ls.len() as i32) {
            self.grow_list();
        }
        self.arena.ls.put(self.arena.ls_pos, item);
        self.arena.ls_pos += 1;
    }

    #[cold]
    #[inline(never)]
    extern "rust-cold" fn grow_list(&mut self) {
        self.make_room(|q| &mut q.arena.ls, self.arena.ls_pos + 4);
    }

    pub(crate) fn list_truncate(&mut self, mark: i32) {
        self.arena.ls_pos = mark;
    }

    /// Moves the items above `mark` of the side stack into the arena.
    #[inline]
    pub(crate) fn list_finish(&mut self, mark: i32) -> i32 {
        let count = self.arena.ls_pos - mark;
        if count == 0 {
            return 0;
        }
        let l = self.arena.n_pos;
        if l + count + 1 > self.arena.n_cap {
            self.grow_ast(l + count + 1);
        }
        // three items at once, whether there are as many or not
        let [a, b, c] = self.arena.ls.several(mark);
        self.n.put_several(l, [count, a, b, c]);
        let mut i: i32 = 3;
        while i < count {
            self.n.put(l + 1 + i, self.arena.ls.at(mark + i));
            i += 1;
        }
        self.arena.n_pos = l + count + 1;
        self.arena.ls_pos = mark;
        return l;
    }
}
