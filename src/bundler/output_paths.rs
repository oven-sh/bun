//! Two output paths that differ only in letter case are one file in an output directory that ignores case. The
//! linker and `bun build --no-bundle` find such paths here and ask the directory.

use std::borrow::Cow;

use bun_alloc::AllocError;
use bun_collections::hashbrown::hash_table::{Entry, HashTable};
use bun_core::{ZBox, strings};
use bun_paths as path;
use bun_sys::E;

/// The first output at a path.
struct Claim<'p, T> {
    key: Cow<'p, [u8]>,
    output: T,
    /// The path as `output` spells it.
    path: &'p [u8],
    /// How many paths were claimed before this one.
    order: u32,
}

/// Two outputs at paths that differ only in ASCII case. `first` claimed its path before `second`.
pub(crate) struct CasePair<T> {
    pub(crate) first: T,
    pub(crate) second: T,
    /// The paths as the outputs spell them.
    pub(crate) first_path: Box<[u8]>,
    pub(crate) second_path: Box<[u8]>,
    first_key: Box<[u8]>,
    second_key: Box<[u8]>,
}

/// The first output at each path of a build. `'p` borrows the paths.
pub(crate) struct FirstAtPath<'p, T> {
    /// Whether a claim also finds the keys that differ from its key only in ASCII case. The keys are then hashed
    /// without ASCII case, so the one probe of a claim meets them.
    pairs_case: bool,
    claims: HashTable<Claim<'p, T>>,
    case_pairs: Vec<CasePair<T>>,
}

impl<'p, T: Copy> FirstAtPath<'p, T> {
    pub(crate) fn with_capacity(pairs_case: bool, capacity: usize) -> Self {
        Self {
            pairs_case,
            claims: HashTable::with_capacity(capacity),
            case_pairs: Vec::new(),
        }
    }

    fn hash(pairs_case: bool, key: &[u8]) -> u64 {
        match pairs_case {
            true => bun_wyhash::hash_ascii_lowercase(0, key),
            false => bun_wyhash::hash(key),
        }
    }

    /// Returns the output that has `key`, with the path as it spells it. If there is none, `output` takes `key`.
    pub(crate) fn claim(
        &mut self,
        key: Cow<'p, [u8]>,
        output: T,
        path: &'p [u8],
    ) -> Option<(T, &'p [u8])> {
        let pairs_case = self.pairs_case;
        let order = self.claims.len() as u32;
        // The first output at this path in another letter case.
        let mut other_case: Option<(u32, T, &'p [u8], Box<[u8]>)> = None;
        let entry = self.claims.entry(
            Self::hash(pairs_case, &key),
            |claim| {
                if claim.key == key {
                    return true;
                }
                if pairs_case
                    && claim.key.eq_ignore_ascii_case(&key)
                    && other_case
                        .as_ref()
                        .is_none_or(|other| claim.order < other.0)
                {
                    other_case = Some((
                        claim.order,
                        claim.output,
                        claim.path,
                        claim.key.as_ref().into(),
                    ));
                }
                false
            },
            |claim| Self::hash(pairs_case, &claim.key),
        );
        match entry {
            Entry::Occupied(entry) => {
                let first = entry.get();
                Some((first.output, first.path))
            }
            Entry::Vacant(entry) => {
                if let Some((_, first, first_path, first_key)) = other_case {
                    self.case_pairs.push(CasePair {
                        first,
                        second: output,
                        first_path: first_path.into(),
                        second_path: path.into(),
                        first_key,
                        second_key: key.as_ref().into(),
                    });
                }
                entry.insert(Claim {
                    key,
                    output,
                    path,
                    order,
                });
                None
            }
        }
    }

    pub(crate) fn into_case_pairs(self) -> Vec<CasePair<T>> {
        self.case_pairs
    }
}

/// Calls `lose` for each pair that `output_dir` stores as one file and that `bytes_differ` says gets different
/// bytes: the second output would replace the first. Returns a note for the error about the first such pair.
pub(crate) fn lost_case_pairs<T: Copy>(
    pairs: &[CasePair<T>],
    output_dir: &[u8],
    mut bytes_differ: impl FnMut(T, T) -> Result<bool, AllocError>,
    mut lose: impl FnMut(&CasePair<T>) -> Result<(), AllocError>,
) -> Result<Option<Vec<u8>>, AllocError> {
    let mut directory = OutputDirectory {
        root: output_dir,
        folds_case: Vec::new(),
    };
    let mut note = None;
    for pair in pairs {
        match directory.is_one_file(pair) {
            Ok(true) => {}
            Ok(false) => continue,
            // No answer. The build goes on as it does without this check.
            Err(_) => continue,
        }
        if !bytes_differ(pair.first, pair.second)? {
            continue;
        }
        note.get_or_insert_with(|| {
            [
                b"the output directory stores '".as_slice(),
                &pair.first_path,
                b"' and '",
                &pair.second_path,
                b"' as one file",
            ]
            .concat()
        });
        lose(pair)?;
    }
    Ok(note)
}

struct OutputDirectory<'r> {
    root: &'r [u8],
    /// The directories that were asked if they fold case, with the answers.
    folds_case: Vec<(Vec<u8>, bool)>,
}

impl OutputDirectory<'_> {
    /// Whether the two paths of `pair` are one file in the output directory. The directory itself answers: a volume
    /// decides if it tells `X` from `x`, not the host, and a link makes two names one file on any volume.
    fn is_one_file<T>(&mut self, pair: &CasePair<T>) -> bun_sys::Maybe<bool> {
        // A Windows volume ignores case unless a directory opted out.
        if cfg!(windows) {
            return Ok(true);
        }
        let file = |key: &[u8]| -> bun_sys::Maybe<Option<bun_sys::Stat>> {
            match bun_sys::stat(ZBox::from_vec([self.root, b"/", key].concat()).as_zstr()) {
                Ok(stat) => Ok(Some(stat)),
                Err(e) if matches!(e.get_errno(), E::ENOENT | E::ENOTDIR) => Ok(None),
                Err(e) => Err(e),
            }
        };
        // A link, or a file that an earlier build left in a directory that folds case.
        if let (Some(first), Some(second)) = (file(&pair.first_key)?, file(&pair.second_key)?)
            && first.st_dev == second.st_dev
            && first.st_ino == second.st_ino
        {
            return Ok(true);
        }
        // Otherwise each directory that gets a name in two spellings has to fold case.
        let mut directory = self.root.to_vec();
        let names =
            strings::split(&pair.first_key, b"/").zip(strings::split(&pair.second_key, b"/"));
        for (first, second) in names {
            if first != second && !self.folds_case(&directory)? {
                return Ok(false);
            }
            directory.push(b'/');
            directory.extend_from_slice(first);
        }
        Ok(true)
    }

    /// A directory that does not exist yet is answered by the deepest directory above it that exists.
    fn folds_case(&mut self, directory: &[u8]) -> bun_sys::Maybe<bool> {
        if let Some((_, folds)) = self.folds_case.iter().find(|(asked, _)| asked == directory) {
            return Ok(*folds);
        }
        let mut existing = directory;
        let folds = loop {
            match bun_sys::directory_folds_ascii_case(existing) {
                Err(e) if e.get_errno() == E::ENOENT => {
                    let parent = path::resolve_path::dirname::<path::platform::Posix>(existing);
                    let parent = if parent.is_empty() { b"." } else { parent };
                    if parent == existing {
                        return Err(e);
                    }
                    existing = parent;
                }
                answer => break answer?,
            }
        };
        self.folds_case.push((directory.to_vec(), folds));
        Ok(folds)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Claims `paths` in order, each as its own key and for the output named by its index. Returns the outputs
    /// that met an earlier output at their key, and the pairs whose paths differ only in case.
    fn claim_all(pairs_case: bool, paths: &[&'static [u8]]) -> (Vec<[usize; 2]>, Vec<[usize; 2]>) {
        let mut first_at_path = FirstAtPath::with_capacity(pairs_case, 1);
        let mut duplicates = Vec::new();
        for (output, path) in paths.iter().enumerate() {
            if let Some((first, first_path)) =
                first_at_path.claim(Cow::Borrowed(path), output, path)
            {
                assert_eq!(first_path, paths[first]);
                duplicates.push([first, output]);
            }
        }
        let case_pairs = first_at_path.into_case_pairs();
        for pair in &case_pairs {
            assert_eq!(
                (&*pair.first_path, &*pair.second_path),
                (paths[pair.first], paths[pair.second])
            );
        }
        let case_pairs = case_pairs.iter().map(|pair| [pair.first, pair.second]);
        (duplicates, case_pairs.collect())
    }

    #[test]
    fn paths_that_differ_only_in_ascii_case_pair() {
        let paths: &[&[u8]] = &[
            b"Logo.png",
            b"logo.png",
            b"logo.png",
            b"LOGO.png",
            b"sub/x.js",
            b"Sub/x.js",
            b"\xc3\x89.png",
            b"\xc3\xa9.png",
            b"logo.pn",
        ];
        let (duplicates, case_pairs) = claim_all(true, paths);
        // An equal path is a duplicate, also of a spelling that is not the first one.
        assert_eq!(duplicates, [[1, 2]]);
        // Every spelling pairs with the first one. `É` and `é` are not ASCII.
        assert_eq!(case_pairs, [[0, 1], [0, 3], [4, 5]]);
    }

    #[test]
    fn paths_pair_only_on_request() {
        let paths: &[&[u8]] = &[b"Logo.png", b"logo.png", b"LOGO.png", b"Logo.png"];
        let (duplicates, case_pairs) = claim_all(false, paths);
        assert_eq!(duplicates, [[0, 3]]);
        assert_eq!(case_pairs, [[0usize; 2]; 0]);
    }

    #[test]
    fn claims_survive_growth() {
        let names: Vec<Vec<u8>> = (0..200)
            .flat_map(|i| [format!("Entry{i}.js"), format!("entry{i}.js")])
            .map(String::into_bytes)
            .collect();
        let mut first_at_path = FirstAtPath::with_capacity(true, 1);
        for (output, name) in names.iter().enumerate() {
            assert!(
                first_at_path
                    .claim(Cow::Borrowed(name), output, name)
                    .is_none()
            );
        }
        let case_pairs: Vec<[usize; 2]> = (first_at_path.into_case_pairs().iter())
            .map(|pair| [pair.first, pair.second])
            .collect();
        let expected: Vec<[usize; 2]> = (0..200).map(|i| [2 * i, 2 * i + 1]).collect();
        assert_eq!(case_pairs, expected);
    }
}
