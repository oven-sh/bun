//! When a file fails to import a relative path, directory watchers are added so
//! that when a matching file is created, the dependencies can be rebuilt. This
//! handles HMR cases where a user writes an import before creating the file,
//! or moves files around. This structure is not thread-safe.
//!
//! This structure manages those watchers, including releasing them once
//! import resolution failures are solved.
// TODO: when a file fixes its resolution, there is no code specifically to remove the watchers.

// ported from: src/bake/DevServer/DirectoryWatchStore.zig
