//! Flattens a display list into a few kinds of primitives (`flatten`), which leaves what they cannot draw to `cpu`.

mod arena;
pub mod blend;
pub mod blur;
mod border;
pub mod cpu;
mod digest;
pub mod edges;
pub mod filter;
pub mod flatten;
pub mod gradient;
mod graph;
#[cfg(any(test, target_os = "macos"))]
pub mod layers;
pub mod raster;
pub mod scene;
pub mod software;
mod stretch;
pub mod warp;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
mod wide;
