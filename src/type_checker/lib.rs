//! What `Bun.TypeChecker` computes without the engine: selectors, the state a check starts from, and the snapshot it produces.
#![forbid(unsafe_code)]

mod check;
mod merge;
mod path;
mod snapshot;
mod state;

pub use check::run_check;
pub use merge::merge_results;
pub use path::{
    FileFilter, PathError, canonical_key, canonical_selector, check_no_nul,
    file_system_is_case_sensitive, is_same_path, resolve_against,
};
pub use snapshot::{
    AdapterError, ChainData, DiagnosticData, ProjectData, SnapshotData, category_name,
    native_file_name,
};
pub use state::{CanonicalPath, DesiredState, OpenProject, SourceOverlay};
