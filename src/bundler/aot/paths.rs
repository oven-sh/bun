use bun_ast::{Loc, Log};
use bun_paths::resolve_path::{self, platform::Auto};
use bun_paths::{MAX_PATH_BYTES, is_sep_native};

pub(super) fn absolute_path(working_directory: &[u8], path: &[u8]) -> Vec<u8> {
    let mut spill = Vec::new();
    resolve_path::join_abs_string_spill::<Auto>(working_directory, &mut spill, &[path]).to_vec()
}

pub(super) fn relative_path(working_directory: &[u8], from: &[u8], to: &[u8]) -> Option<Vec<u8>> {
    let from = absolute_path(working_directory, from);
    let to = absolute_path(working_directory, to);
    let fits = from.len() < MAX_PATH_BYTES
        && to.len() < MAX_PATH_BYTES
        && max_relative_path_length(&from, &to) < MAX_PATH_BYTES;
    fits.then(|| resolve_path::relative_platform::<Auto, false>(&from, &to).to_vec())
}

pub(super) fn report_long_path(log: &mut Log, kind: &str, path: &[u8]) {
    log.add_error_fmt(
        None,
        Loc::EMPTY,
        format_args!("the {kind} \"{}\" is too long", bstr::BStr::new(path)),
    );
}

fn segments(path: &[u8]) -> impl Iterator<Item = &[u8]> {
    path.split(|&byte| is_sep_native(byte))
        .filter(|segment| !segment.is_empty())
}

fn max_relative_path_length(from: &[u8], to: &[u8]) -> usize {
    let shared_count = segments(from)
        .zip(segments(to))
        .take_while(|(a, b)| a == b)
        .count();
    let parent_count = segments(from).skip(shared_count).count();
    let rest_length: usize = segments(to)
        .skip(shared_count)
        .map(|segment| segment.len() + 1)
        .sum();
    3 * parent_count + rest_length
}
