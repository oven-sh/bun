//! What `Bun.TypeChecker` computes without the engine: selectors, the state a check starts from, and the snapshot it produces.
#![forbid(unsafe_code)]

mod check;
mod merge;
mod path;
mod snapshot;
mod state;

pub use check::run_check;
pub use merge::merge_results;
pub use path::{PathError, canonical_selector, check_no_nul, resolve_against};
pub use snapshot::{
    AdapterError, ChainData, DiagnosticData, ProjectData, SnapshotData, category_name,
    native_file_name, normalize_for_filter,
};
pub use state::{CanonicalPath, DesiredState};
