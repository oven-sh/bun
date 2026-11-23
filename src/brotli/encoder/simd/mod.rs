//! The data-parallel parts of the encoder, in the arithmetic of google/brotli (LICENSE.md). All targets give the same results.

mod copies;
mod costs;
mod leaves;
mod pairs;
mod switches;
#[cfg(test)]
mod tests;

pub(crate) use {copies::*, costs::*, leaves::*, pairs::*, switches::*};

const MAX_SYMBOLS: usize = 704;

#[repr(align(32))]
struct Aligned<T>(T);
