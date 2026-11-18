//! Multiplication by number-theoretic transforms modulo three primes.

mod coefficients;
mod leaves;
mod prime;
mod tree;

use super::is_square;
use crate::{Error, Work};
use coefficients::{Combination, Width};
use prime::{Factor, PRIMES};
use tree::{GRAIN, LEAF, Tree};

/// How a product is cut into coefficients.
#[derive(Clone, Copy)]
struct Layout {
    width: Width,
    /// As many as the product has, or a few more.
    count: usize,
    /// That of the tree.
    size: usize,
}

impl Layout {
    fn new(a_length: usize, b_length: usize) -> Layout {
        let width = Width::for_short_operand(a_length.min(b_length));
        let count = (width.count(a_length) + width.count(b_length)).next_multiple_of(GRAIN);
        Layout {
            width,
            count,
            size: count.next_power_of_two(),
        }
    }

    /// The residues modulo each prime follow each other. Only those that are worked on need the room of the tree.
    fn residues_length(self) -> usize {
        (PRIMES.len() - 1) * self.count + self.size
    }

    fn residues_mut(self, all: &mut [u64], prime: usize) -> &mut [u64] {
        &mut all[prime * self.count..][..self.size]
    }

    fn residues(self, all: &[u64], prime: usize) -> &[u64] {
        &all[prime * self.count..][..self.count]
    }

    fn try_roots(self, trees: usize, work: &mut Work<'_>) -> Result<Vec<Factor>, Error> {
        work.try_filled(PRIMES[0].roots[0], trees * Tree::root_count(self.size))
    }

    fn transform(
        self,
        data: &mut [u64],
        digits: &[u64],
        tree: Tree<'_>,
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        self.width.read(data, digits, tree.modulus);
        tree.split(data, 0, self.width.count(digits.len()), self.count, work)
    }

    fn write(self, out: &mut [u64], all: &[u64], work: &mut Work<'_>) -> Result<(), Error> {
        let residues = [0, 1, 2].map(|prime| self.residues(all, prime));
        Combination::new((self.size / LEAF).ilog2()).write(self.width, out, residues, work)
    }
}

pub(super) fn multiply(
    out: &mut [u64],
    a: &[u64],
    b: &[u64],
    work: &mut Work<'_>,
) -> Result<(), Error> {
    let layout = Layout::new(a.len(), b.len());
    let other_length = if is_square(a, b) { 0 } else { layout.size };
    let mut roots = layout.try_roots(1, work)?;
    let mut storage = work.try_filled(0, layout.residues_length() + other_length)?;
    let (residues, other) = storage.split_at_mut(layout.residues_length());
    for (index, prime) in PRIMES.iter().enumerate() {
        let tree = Tree::new(prime, &mut roots);
        let data = layout.residues_mut(residues, index);
        layout.transform(data, a, tree, work)?;
        if is_square(a, b) {
            tree.square_leaves(&mut data[..layout.count], work)?;
        } else {
            layout.transform(other, b, tree, work)?;
            tree.multiply_leaves(&mut data[..layout.count], other, work)?;
        }
        tree.join_root(data, layout.count, work)?;
    }
    layout.write(out, residues, work)
}

/// A number that is transformed once to multiply several others by.
pub(super) struct Transformed {
    layout: Layout,
    max_other_length: usize,
    roots: Vec<Factor>,
    own: Vec<u64>,
    residues: Vec<u64>,
}

impl Transformed {
    pub(super) fn new(
        digits: &[u64],
        max_other_length: usize,
        work: &mut Work<'_>,
    ) -> Result<Transformed, Error> {
        let layout = Layout::new(digits.len(), max_other_length);
        let mut roots = layout.try_roots(PRIMES.len(), work)?;
        let mut residues = work.try_filled(0, layout.residues_length())?;
        let trees = roots.chunks_exact_mut(Tree::root_count(layout.size));
        for (index, (prime, roots)) in PRIMES.iter().zip(trees).enumerate() {
            let data = layout.residues_mut(&mut residues, index);
            layout.transform(data, digits, Tree::new(prime, roots), work)?;
        }
        Ok(Transformed {
            layout,
            max_other_length,
            roots,
            own: residues,
            residues: work.try_filled(0, layout.residues_length())?,
        })
    }

    pub(super) fn max_other_length(&self) -> usize {
        self.max_other_length
    }

    pub(super) fn multiply(
        &mut self,
        out: &mut [u64],
        other: &[u64],
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        let layout = self.layout;
        let trees = self.roots.chunks_exact(Tree::root_count(layout.size));
        for (index, (prime, roots)) in PRIMES.iter().zip(trees).enumerate() {
            let tree = Tree {
                modulus: prime.modulus,
                roots,
            };
            let data = layout.residues_mut(&mut self.residues, index);
            layout.transform(data, other, tree, work)?;
            let own = layout.residues(&self.own, index);
            tree.multiply_leaves(&mut data[..layout.count], own, work)?;
            tree.join_root(data, layout.count, work)?;
        }
        layout.write(out, &self.residues, work)
    }

    /// What fills a tree that is several times as large as `length` alone takes.
    pub(super) fn best_other_length(length: usize) -> usize {
        let width = Width::for_short_operand(length);
        let size = (width.count(length) * 6).next_power_of_two();
        width.length_within(size - width.count(length))
    }
}
