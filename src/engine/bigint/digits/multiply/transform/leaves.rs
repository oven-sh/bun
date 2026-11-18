//! Products of the residues modulo `x^4 - r`.

use super::prime::{Factor, Modulus};
use super::tree::{LEAF, Tree, keep_scalar};
use crate::digits::unroll;
use crate::{Error, Work};

type Leaf = [u64; LEAF];

#[inline(always)]
fn wide(a: u64, b: u64) -> u128 {
    u128::from(a) * u128::from(b)
}

/// Four products of residues below twice the modulus fit in 128 bits.
#[inline(always)]
fn multiply_leaf<const NEGATES: bool>(a: &mut Leaf, b: &Leaf, root: Factor, modulus: Modulus) {
    let (mut x, mut y, mut wrapped) = ([0; LEAF], [0; LEAF], [0; LEAF]);
    unroll!(i in 0, LEAF => {
        x[i] = modulus.narrow(a[i]);
        y[i] = modulus.narrow(b[i]);
    });
    unroll!(i in 1, LEAF => {
        wrapped[i] = modulus.multiply(b[i], root);
        if NEGATES {
            wrapped[i] = modulus.twice().wrapping_sub(wrapped[i]);
        }
    });
    unroll!(k in 0, LEAF => {
        let mut sum = 0u128;
        unroll!(i in 0, LEAF => {
            let other = if i <= k { y[k - i] } else { wrapped[LEAF + k - i] };
            sum = sum.wrapping_add(wide(x[i], other));
        });
        a[k] = modulus.divide_wide_by_radix(sum);
        keep_scalar();
    });
}

#[inline(always)]
fn square_leaf<const NEGATES: bool>(a: &mut Leaf, root: Factor, modulus: Modulus) {
    let wrap = |a: u64| {
        let product = modulus.multiply(a, root);
        if NEGATES {
            modulus.twice().wrapping_sub(product)
        } else {
            product
        }
    };
    let (wrapped2, wrapped3) = (wrap(a[2]), wrap(a[3]));
    let [x0, x1, x2, x3] = [
        modulus.narrow(a[0]),
        modulus.narrow(a[1]),
        modulus.narrow(a[2]),
        modulus.narrow(a[3]),
    ];
    let (doubled0, doubled1, doubled_wrapped3) = (x0 << 1, x1 << 1, wrapped3 << 1);
    let terms = [
        [(x0, x0), (x1, doubled_wrapped3), (x2, wrapped2)],
        [(x0, doubled1), (x2, doubled_wrapped3), (0, 0)],
        [(doubled0, x2), (x1, x1), (x3, wrapped3)],
        [(doubled0, x3), (doubled1, x2), (0, 0)],
    ];
    unroll!(k in 0, LEAF => {
        let mut sum = 0u128;
        unroll!(i in 0, 3 => {
            sum = sum.wrapping_add(wide(terms[k][i].0, terms[k][i].1));
        });
        a[k] = modulus.divide_wide_by_radix(sum);
        keep_scalar();
    });
}

const WORK_PER_PAIR: usize = 16 * LEAF;

impl Tree<'_> {
    /// `a = a * b / 2^64`
    pub(super) fn multiply_leaves(
        self,
        a: &mut [u64],
        b: &[u64],
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        let a = a.as_chunks_mut().0.as_chunks_mut().0;
        let b = b.as_chunks().0.as_chunks().0;
        for (([a_left, a_right], [b_left, b_right]), &root) in a.iter_mut().zip(b).zip(self.roots) {
            work.spend(WORK_PER_PAIR)?;
            multiply_leaf::<false>(a_left, b_left, root, self.modulus);
            multiply_leaf::<true>(a_right, b_right, root, self.modulus);
        }
        Ok(())
    }

    /// `a = a * a / 2^64`
    pub(super) fn square_leaves(self, a: &mut [u64], work: &mut Work<'_>) -> Result<(), Error> {
        let a = a.as_chunks_mut().0.as_chunks_mut().0;
        for ([left, right], &root) in a.iter_mut().zip(self.roots) {
            work.spend(WORK_PER_PAIR)?;
            square_leaf::<false>(left, root, self.modulus);
            square_leaf::<true>(right, root, self.modulus);
        }
        Ok(())
    }
}
