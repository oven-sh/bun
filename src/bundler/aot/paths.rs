use bun_ast::{Loc, Log};
use bun_paths::{MAX_PATH_BYTES, Path};

pub(super) fn absolute_path(working_directory: &[u8], path: &[u8]) -> Vec<u8> {
    bun_resolver::resolve_keeping_sep(&[working_directory, path]).to_vec()
}

pub(super) fn relative_path(working_directory: &[u8], from: &[u8], to: &[u8]) -> Option<Vec<u8>> {
    let from = absolute_path(working_directory, from);
    let to = absolute_path(working_directory, to);
    let fits = from.len() < MAX_PATH_BYTES && to.len() < MAX_PATH_BYTES;
    let relative = Path::relative(&from, &to)
        .check_len()
        .ok()
        .filter(|_| fits)?;
    Some(relative.to_vec())
}

pub(super) fn report_long_path(log: &mut Log, kind: &str, path: &[u8]) {
    log.add_error_fmt(
        None,
        Loc::EMPTY,
        format_args!("the {kind} \"{}\" is too long", bstr::BStr::new(path)),
    );
}

/// Two spellings of one file have the same identity.
pub struct FileIdentity {
    device: u64,
    inode: u64,
    /// Of a file without an inode number: some file systems report 0 for every file.
    path: Option<Vec<u8>>,
}

impl FileIdentity {
    pub fn new(
        device: u64,
        inode: u64,
        find_path: impl FnOnce() -> Option<Vec<u8>>,
    ) -> FileIdentity {
        FileIdentity {
            device,
            inode,
            path: if inode == 0 { find_path() } else { None },
        }
    }

    pub fn is_same_file(&self, other: &FileIdentity) -> bool {
        self.device == other.device
            && self.inode == other.inode
            && (self.inode != 0 || (self.path.is_some() && self.path == other.path))
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    const WORKING_DIRECTORY: &[u8] = b"/project";

    fn relative(from: &[u8], to: &[u8]) -> Option<Vec<u8>> {
        relative_path(WORKING_DIRECTORY, from, to)
    }

    #[test]
    fn files_are_compared_by_inode_number() {
        let file =
            |device, inode| FileIdentity::new(device, inode, || panic!("asked for the path"));
        assert!(file(1, 7).is_same_file(&file(1, 7)));
        assert!(!file(1, 7).is_same_file(&file(1, 8)));
        assert!(!file(1, 7).is_same_file(&file(2, 7)));
    }

    #[test]
    fn files_without_inode_number_are_compared_by_path() {
        let file = |device, path: &[u8]| FileIdentity::new(device, 0, || Some(path.to_vec()));
        let app = file(1, b"/project/app.ts");
        assert!(app.is_same_file(&file(1, b"/project/app.ts")));
        assert!(!app.is_same_file(&file(1, b"/project/app")));
        assert!(!app.is_same_file(&file(2, b"/project/app.ts")));

        let without_path = || FileIdentity::new(1, 0, || None);
        assert!(!without_path().is_same_file(&without_path()));
        assert!(!app.is_same_file(&without_path()));
        assert!(!app.is_same_file(&FileIdentity::new(1, 7, || None)));
    }

    #[test]
    fn absolute_path_joins_and_normalizes() {
        assert_eq!(
            absolute_path(WORKING_DIRECTORY, b"src/../a.ts"),
            b"/project/a.ts"
        );
        assert_eq!(
            absolute_path(WORKING_DIRECTORY, b"/other/a.ts"),
            b"/other/a.ts"
        );
        assert_eq!(absolute_path(WORKING_DIRECTORY, b""), b"/project");
    }

    #[test]
    fn relative_path_descends_from_ancestor() {
        assert_eq!(
            relative(b"/project/src", b"/project/src/a/b.ts"),
            Some(b"a/b.ts".to_vec())
        );
        assert_eq!(
            relative(b"/", b"/project/a.ts"),
            Some(b"project/a.ts".to_vec())
        );
    }

    #[test]
    fn relative_path_climbs_to_shared_directory() {
        assert_eq!(
            relative(b"/project/src", b"/project/lib/b.ts"),
            Some(b"../lib/b.ts".to_vec())
        );
        assert_eq!(
            relative(b"/project/src", b"/project/src-gen/b.ts"),
            Some(b"../src-gen/b.ts".to_vec())
        );
    }

    #[test]
    fn relative_inputs_start_at_working_directory() {
        assert_eq!(relative(b"src", b"lib/b.ts"), Some(b"../lib/b.ts".to_vec()));
        assert_eq!(relative(b"", b"a.ts"), Some(b"a.ts".to_vec()));
    }

    #[test]
    fn deep_directory_contains_file() {
        let directory = b"/a".repeat(MAX_PATH_BYTES / 2 - 2);
        let file = [&directory[..], b"/x"].concat();
        assert_eq!(relative(&directory, &file), Some(b"x".to_vec()));
    }

    #[test]
    fn climb_out_of_deep_directory_is_too_long() {
        let directory = b"/a".repeat(MAX_PATH_BYTES / 2 - 2);
        assert!(directory.len() < MAX_PATH_BYTES);
        assert_eq!(relative(&directory, b"/b"), None);
    }

    #[test]
    fn long_input_is_too_long() {
        let long = [b'a'; MAX_PATH_BYTES];
        assert_eq!(relative(b"/project", &long), None);
        assert_eq!(relative(&long, b"/project/a.ts"), None);
    }

    #[test]
    fn long_path_message_names_kind_and_path() {
        let mut log = Log::init();
        report_long_path(&mut log, "entry point", b"a.ts");
        assert_eq!(log.errors, 1);
        assert_eq!(
            &*log.msgs[0].data.text,
            b"the entry point \"a.ts\" is too long"
        );
    }
}
