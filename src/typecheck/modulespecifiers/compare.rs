// modulespecifiers/compare.go
pub fn count_path_components(path: &[u8]) -> isize {
    let mut initial = 0;
    if path.starts_with(b"./") {
        initial = 2;
    }
    path.get(initial..)
        .unwrap_or(&[])
        .iter()
        .filter(|ch| **ch == b'/')
        .count() as isize
}
