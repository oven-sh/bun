//! What this crate and `bun_zlib` compress with.

mod block;
mod codes;
mod grams;
mod parser;
mod scratch;
mod window;

pub use block::{Block, Plan};
pub use bun_highway::deflate::Bits;
pub use parser::{Effort, Method, Parser};
pub use scratch::Scratch;
pub use window::Window;
