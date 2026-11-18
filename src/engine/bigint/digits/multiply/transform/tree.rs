//! A polynomial modulo `x^n - 1` is split into its residues modulo the factors of that, down to degree [`LEAF`].
//! The node `j` of a level stands for `x^n - r^2` with `r = roots[j]`. Its children `2j` and `2j + 1` stand for
//! `x^(n/2) - r` and `x^(n/2) + r`. Only as many leaves are worked out as the product has coefficients:
//! van der Hoeven, The truncated Fourier transform and applications.

use super::prime::{Factor, Modulus, Prime};
use crate::{Error, Work};

pub(super) const LEAF: usize = 4;
/// The number of coefficients worked out is a multiple of this.
pub(super) const GRAIN: usize = 4 * LEAF;
/// Up to this size a node is done one level after the other. It fits in the first cache.
const BLOCK: usize = 1 << 11;

#[derive(Clone, Copy)]
pub(super) struct Tree<'a> {
    pub(super) modulus: Modulus,
    pub(super) roots: &'a [Factor],
}

impl<'a> Tree<'a> {
    pub(super) const fn root_count(size: usize) -> usize {
        size / (2 * LEAF)
    }

    /// The length of `roots` is a power of two.
    pub(super) fn new(prime: &Prime, roots: &'a mut [Factor]) -> Tree<'a> {
        let modulus = prime.modulus;
        roots[0] = modulus.factor(1);
        for (bit, &root) in prime.roots[..roots.len().ilog2() as usize]
            .iter()
            .enumerate()
        {
            let (known, next) = roots.split_at_mut(1 << bit);
            for (next, &known) in next.iter_mut().zip(&*known) {
                keep_scalar();
                *next = modulus.factor_product(known, root);
            }
        }
        Tree { modulus, roots }
    }

    /// The node whose root is the negative reciprocal of that of `node`, which is not the first.
    #[inline(always)]
    fn mirror(node: usize) -> usize {
        node ^ ((1 << node.ilog2()) - 1)
    }

    /// Coefficients and residues are below four times the modulus.
    #[inline(always)]
    fn split_pair(self, low: u64, high: u64, root: Option<Factor>) -> (u64, u64) {
        let low = self.modulus.narrow(low);
        let high = match root {
            Some(root) => self.modulus.multiply(high, root),
            None => self.modulus.narrow(high),
        };
        (
            low.wrapping_add(high),
            self.modulus.subtract_wide(low, high),
        )
    }

    /// Residues and coefficients are below twice the modulus, and the coefficients come out doubled.
    #[inline(always)]
    fn join_pair(self, left: u64, right: u64, mirror_root: Option<Factor>) -> (u64, u64) {
        let high = match mirror_root {
            Some(root) => {
                let difference = self.modulus.subtract_wide(right, left);
                self.modulus.multiply(difference, root)
            }
            None => self.modulus.subtract(left, right),
        };
        (self.modulus.add(left, right), high)
    }

    fn split_halves(self, low: &mut [u64], high: &mut [u64], node: usize) {
        if node == 0 {
            for (low, high) in low.iter_mut().zip(high) {
                (*low, *high) = self.split_pair(*low, *high, None);
            }
        } else {
            let root = self.roots[node];
            for (low, high) in low.iter_mut().zip(high) {
                keep_scalar();
                (*low, *high) = self.split_pair(*low, *high, Some(root));
            }
        }
    }

    fn join_halves(self, left: &mut [u64], right: &mut [u64], node: usize) {
        if node == 0 {
            for (left, right) in left.iter_mut().zip(right) {
                (*left, *right) = self.join_pair(*left, *right, None);
            }
        } else {
            let root = self.roots[Self::mirror(node)];
            for (left, right) in left.iter_mut().zip(right) {
                keep_scalar();
                (*left, *right) = self.join_pair(*left, *right, Some(root));
            }
        }
    }

    #[inline(always)]
    fn split_four(self, data: &mut [u64], roots: &[Option<Factor>; 3]) {
        let [a, b, c, d] = quarters(data);
        for (((a, b), c), d) in a.iter_mut().zip(b).zip(c).zip(d) {
            keep_scalar();
            let (left_low, right_low) = self.split_pair(*a, *c, roots[0]);
            let (left_high, right_high) = self.split_pair(*b, *d, roots[0]);
            (*a, *b) = self.split_pair(left_low, left_high, roots[1]);
            (*c, *d) = self.split_pair(right_low, right_high, roots[2]);
        }
    }

    #[inline(always)]
    fn join_four(self, data: &mut [u64], mirror_roots: &[Option<Factor>; 3]) {
        let [a, b, c, d] = quarters(data);
        for (((a, b), c), d) in a.iter_mut().zip(b).zip(c).zip(d) {
            keep_scalar();
            let (left_low, left_high) = self.join_pair(*a, *b, mirror_roots[1]);
            let (right_low, right_high) = self.join_pair(*c, *d, mirror_roots[2]);
            (*a, *c) = self.join_pair(left_low, right_low, mirror_roots[0]);
            (*b, *d) = self.join_pair(left_high, right_high, mirror_roots[0]);
        }
    }

    /// Two levels down, for the nodes of `size` from `first` on.
    fn split_quarters(self, mut data: &mut [u64], size: usize, mut first: usize) {
        if first == 0 {
            let head;
            (head, data) = data.split_at_mut(size);
            self.split_four(head, &[None, None, Some(self.roots[1])]);
            first = 1;
        }
        let pairs = &self.roots.as_chunks::<2>().0[first..];
        let roots = self.roots[first..].iter().zip(pairs);
        if size == GRAIN {
            for (node, (&root, &[left, right])) in
                data.as_chunks_mut::<GRAIN>().0.iter_mut().zip(roots)
            {
                self.split_four(node, &[Some(root), Some(left), Some(right)]);
            }
        } else {
            for (node, (&root, &[left, right])) in data.chunks_exact_mut(size).zip(roots) {
                self.split_four(node, &[Some(root), Some(left), Some(right)]);
            }
        }
    }

    /// Two levels up, to the nodes of `size` from `first` on.
    fn join_quarters(self, mut data: &mut [u64], size: usize, mut first: usize) {
        if first == 0 {
            let head;
            (head, data) = data.split_at_mut(size);
            self.join_four(head, &[None, None, Some(self.roots[1])]);
            first = 1;
        }
        let pairs = self.roots.as_chunks::<2>().0;
        let roots = (first..).map(|node| {
            let mirror = Self::mirror(node);
            let [right, left] = pairs[mirror];
            [Some(self.roots[mirror]), Some(left), Some(right)]
        });
        if size == GRAIN {
            for (node, roots) in data.as_chunks_mut::<GRAIN>().0.iter_mut().zip(roots) {
                self.join_four(node, &roots);
            }
        } else {
            for (node, roots) in data.chunks_exact_mut(size).zip(roots) {
                self.join_four(node, &roots);
            }
        }
    }

    fn split_all(self, data: &mut [u64], node: usize, work: &mut Work<'_>) -> Result<(), Error> {
        let mut size = data.len();
        if size > BLOCK {
            self.split_quarters(data, size, node);
            work.spend(4 * size)?;
            for (index, quarter) in quarters(data).into_iter().enumerate() {
                self.split_all(quarter, 4 * node + index, work)?;
            }
            return Ok(());
        }
        let mut first = node;
        if (size / LEAF).ilog2() % 2 != 0 {
            let (low, high) = data.split_at_mut(size / 2);
            self.split_halves(low, high, node);
            (size, first) = (size / 2, 2 * first);
        }
        while size > LEAF {
            self.split_quarters(data, size, first);
            (size, first) = (size / 4, 4 * first);
        }
        work.spend(16 * data.len())
    }

    fn join_all(self, data: &mut [u64], node: usize, work: &mut Work<'_>) -> Result<(), Error> {
        if data.len() > BLOCK {
            for (index, quarter) in quarters(data).into_iter().enumerate() {
                self.join_all(quarter, 4 * node + index, work)?;
            }
            self.join_quarters(data, data.len(), node);
            return work.spend(4 * data.len());
        }
        let mut size = GRAIN;
        while size <= data.len() {
            self.join_quarters(data, size, node * (data.len() / size));
            size *= 4;
        }
        if size == 2 * data.len() {
            let (left, right) = data.split_at_mut(data.len() / 2);
            self.join_halves(left, right, node);
        }
        work.spend(16 * data.len())
    }

    /// Turns the first `given` elements of `data`, the coefficients that are not zero, into the first `wanted` of
    /// the residues.
    pub(super) fn split(
        self,
        data: &mut [u64],
        node: usize,
        given: usize,
        wanted: usize,
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        if wanted == data.len() && (given == wanted || wanted == GRAIN) {
            data[given..].fill(0);
            return self.split_all(data, node, work);
        }
        let half = data.len() / 2;
        let (low, high) = data.split_at_mut(half);
        let (given_low, given_high) = (given.min(half), given.saturating_sub(half));
        self.split_halves(&mut low[..given_high], &mut high[..given_high], node);
        work.spend(half)?;
        if wanted > half {
            high[given_high..given_low].copy_from_slice(&low[given_high..given_low]);
            self.split(high, 2 * node + 1, given_low, wanted - half, work)?;
        }
        self.split(low, 2 * node, given_low, wanted.min(half), work)
    }

    /// Turns the first `wanted` elements of `data`, more than half, from residues into the coefficients that are not
    /// zero, times the number of leaves of the tree.
    pub(super) fn join_root(
        self,
        data: &mut [u64],
        wanted: usize,
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        if wanted == data.len() {
            return self.join_all(data, 0, work);
        }
        let (left, right) = data.split_at_mut(data.len() / 2);
        let wanted_right = wanted - left.len();
        self.join_all(left, 0, work)?;
        right[wanted_right..].copy_from_slice(&left[wanted_right..]);
        for left in &mut left[wanted_right..] {
            *left = self.modulus.add(*left, *left);
        }
        self.join(right, 1, wanted_right, work)?;
        self.join_halves(&mut left[..wanted_right], &mut right[..wanted_right], 0);
        Ok(())
    }

    /// The first `wanted` elements of `data` are residues and the others coefficients. Turns the residues into
    /// coefficients. All of these are taken times the number of leaves of the node.
    fn join(
        self,
        data: &mut [u64],
        node: usize,
        wanted: usize,
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        if wanted == data.len() {
            return self.join_all(data, node, work);
        }
        let (modulus, root) = (self.modulus, self.roots[node]);
        let half = data.len() / 2;
        let (left, right) = data.split_at_mut(half);
        work.spend(2 * half)?;
        if let Some(wanted_right) = wanted.checked_sub(half) {
            self.join_all(left, 2 * node, work)?;
            for (left, right) in left[wanted_right..]
                .iter_mut()
                .zip(&mut right[wanted_right..])
            {
                keep_scalar();
                *right = modulus.subtract(*left, modulus.multiply(*right, root));
                *left = modulus.add(*left, *right);
            }
            if wanted_right != 0 {
                self.join(right, 2 * node + 1, wanted_right, work)?;
                self.join_halves(&mut left[..wanted_right], &mut right[..wanted_right], node);
            }
        } else {
            for (left, &right) in left[wanted..].iter_mut().zip(&right[wanted..]) {
                keep_scalar();
                *left = modulus.halve(modulus.add(*left, modulus.multiply(right, root)));
            }
            self.join(left, 2 * node, wanted, work)?;
            for (left, &right) in left[..wanted].iter_mut().zip(&*right) {
                keep_scalar();
                let doubled = modulus.add(*left, *left);
                *left = modulus.subtract(doubled, modulus.multiply(right, root));
            }
        }
        Ok(())
    }
}

#[inline(always)]
fn quarters(data: &mut [u64]) -> [&mut [u64]; 4] {
    let quarter = data.len() / 4;
    let (a, rest) = data.split_at_mut(quarter);
    let (b, rest) = rest.split_at_mut(quarter);
    let (c, d) = rest.split_at_mut(quarter);
    [a, b, c, d]
}

/// In a loop, keeps the compiler from building 64-bit multiplications out of narrower vector ones, which is slower.
#[inline(always)]
pub(super) fn keep_scalar() {
    core::hint::black_box(());
}
