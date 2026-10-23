use crate::options::Externals;
use bun_core::strings::last_index_of_char;
use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
use bun_paths::{is_absolute, is_package_path, path_buffer_pool};

pub(crate) fn is_external(externals: &Externals, specifier: &[u8], directory: &[u8]) -> bool {
    if matches_pattern(&externals.patterns, specifier) {
        return true;
    }
    if is_package_path(specifier) {
        return externals.are_all_packages || matches_package(&externals.packages, specifier);
    }
    matches_path(&externals.paths, specifier, directory)
}

fn matches_pattern(patterns: &[(Vec<u8>, Vec<u8>)], specifier: &[u8]) -> bool {
    patterns.iter().any(|(prefix, suffix)| {
        specifier.len() >= prefix.len() + suffix.len()
            && specifier.starts_with(prefix)
            && specifier.ends_with(suffix)
    })
}

fn matches_package(packages: &[Vec<u8>], specifier: &[u8]) -> bool {
    if packages.is_empty() || specifier.ends_with(b"/") {
        return false;
    }
    let mut query = specifier;
    loop {
        if contains(packages, query) {
            return true;
        }
        match last_index_of_char(query, b'/') {
            Some(slash) => query = &query[..slash],
            None => return false,
        }
    }
}

fn matches_path(paths: &[Vec<u8>], specifier: &[u8], directory: &[u8]) -> bool {
    if paths.is_empty() {
        return false;
    }
    if is_absolute(specifier) {
        return contains(paths, specifier);
    }
    if !is_absolute(directory) {
        return false;
    }
    let mut buffer = path_buffer_pool::get();
    join_abs_string_buf_checked::<platform::Auto>(directory, &mut buffer[..], &[specifier])
        .is_some_and(|path| contains(paths, path))
}

fn contains(sorted_list: &[Vec<u8>], item: &[u8]) -> bool {
    sorted_list
        .binary_search_by(|entry| entry.as_slice().cmp(item))
        .is_ok()
}
