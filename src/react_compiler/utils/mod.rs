#![allow(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    reason = "ported from facebook/react upstream; uses std collections by design"
)]
#![allow(unreachable_pub)]

pub mod disjoint_set;

pub use disjoint_set::DisjointSet;
