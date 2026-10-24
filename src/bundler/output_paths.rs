//! Every output of a build needs its own file. The linker and `bun build --no-bundle` claim their output paths here.

use std::borrow::Cow;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_collections::StringArrayHashMap;
use bun_collections::hashbrown::hash_table::{Entry, HashTable};
use bun_core::{ZBox, ZStr, strings};
use bun_paths as path;
use bun_sys::{E, O};

/// Where the outputs of a build go. It decides which paths name one file.
#[derive(Clone, Copy)]
pub(crate) enum Destination<'a> {
    /// Bun writes each output to its path in this directory. `a/../x`, `./x` and `.//x` are one file there, and only
    /// the directory knows if it tells `X` from `x`.
    Directory(&'a [u8]),
    /// The paths are only returned. They compare like paths in a directory that tells `X` from `x`.
    Returned,
    /// An executable stores a file under its path less one leading `./` (`StandaloneModuleGraph::module_dest_path`)
    /// and resolves nothing else: `a/../x` and `x` are two files there.
    Executable,
}

/// Two spellings of one output file have one key, except for spellings that differ in letter case. `path` has `/`
/// separators on every platform.
pub(crate) fn output_path_key<'a>(
    destination: Destination<'_>,
    mut path: &'a [u8],
) -> Cow<'a, [u8]> {
    if matches!(destination, Destination::Executable) {
        return Cow::Borrowed(strings::remove_leading_dot_slash(path));
    }
    while let Some(rest) = path.strip_prefix(b"./") {
        path = rest;
    }
    if strings::split(path, b"/").all(|segment| !matches!(segment, b"" | b"." | b"..")) {
        return Cow::Borrowed(path);
    }
    let mut buf = vec![0u8; path.len() + 1];
    let len = path::resolve_path::normalize_string_generic_t::<u8, true, false>(
        path,
        &mut buf,
        b'/',
        path::resolve_path::is_sep_posix_t::<u8>,
    )
    .len();
    buf.truncate(len);
    Cow::Owned(buf)
}

/// The first output at a path.
struct Claim<'p, T> {
    key: Cow<'p, [u8]>,
    output: T,
    /// The path as `output` spells it.
    path: &'p [u8],
    /// Bun writes `output` to `path` in the output directory.
    written: bool,
    /// How many paths were claimed before this one.
    order: u32,
}

/// Two outputs that bun writes to paths that differ only in ASCII case. `first` claimed its path before `second`.
struct CasePair<T> {
    first: T,
    second: T,
    first_path: Box<[u8]>,
    second_path: Box<[u8]>,
}

/// The output paths of one build. `'p` borrows the paths.
pub(crate) struct OutputPaths<'p, 'd, T> {
    destination: Destination<'d>,
    /// Hashed without ASCII case for a directory, so the one probe of a claim also meets the paths that differ from
    /// its path only in case.
    claims: HashTable<Claim<'p, T>>,
    duplicates: StringArrayHashMap<Vec<T>>,
    case_pairs: Vec<CasePair<T>>,
}

fn hash(destination: Destination<'_>, key: &[u8]) -> u64 {
    match destination {
        Destination::Directory(_) => bun_wyhash::hash_ascii_lowercase(0, key),
        Destination::Returned | Destination::Executable => bun_wyhash::hash(key),
    }
}

impl<'p, 'd, T: Copy> OutputPaths<'p, 'd, T> {
    pub(crate) fn with_capacity(destination: Destination<'d>, capacity: usize) -> Self {
        Self {
            destination,
            claims: HashTable::with_capacity(capacity),
            duplicates: StringArrayHashMap::default(),
            case_pairs: Vec::new(),
        }
    }

    /// Gives `path` to `output`. If an earlier output has it, `may_share` says if the two may share it.
    pub(crate) fn claim(
        &mut self,
        output: T,
        path: &'p [u8],
        may_share: impl FnOnce(T) -> bool,
    ) -> Result<(), AllocError> {
        let written = matches!(self.destination, Destination::Directory(_));
        self.claim_as(output, path, written, may_share)
    }

    /// [`Self::claim`] for an output that bun does not write to `path`, like a chunk that standalone HTML inlines.
    pub(crate) fn claim_inlined(&mut self, output: T, path: &'p [u8]) -> Result<(), AllocError> {
        self.claim_as(output, path, false, |_| false)
    }

    fn claim_as(
        &mut self,
        output: T,
        path: &'p [u8],
        written: bool,
        may_share: impl FnOnce(T) -> bool,
    ) -> Result<(), AllocError> {
        let destination = self.destination;
        let key = output_path_key(destination, path);
        let order = self.claims.len() as u32;
        // The first written output at this path in another letter case.
        let mut other_case: Option<(u32, T, &'p [u8])> = None;
        let entry = self.claims.entry(
            hash(destination, &key),
            |claim| {
                if claim.key == key {
                    return true;
                }
                if written
                    && claim.written
                    && claim.key.eq_ignore_ascii_case(&key)
                    && other_case.is_none_or(|(order, ..)| claim.order < order)
                {
                    other_case = Some((claim.order, claim.output, claim.path));
                }
                false
            },
            |claim| hash(destination, &claim.key),
        );
        match entry {
            Entry::Occupied(entry) => {
                let first = entry.get();
                if !may_share(first.output) {
                    add_duplicate(&mut self.duplicates, first.path, first.output, output)?;
                }
            }
            Entry::Vacant(entry) => {
                entry.insert(Claim {
                    key,
                    output,
                    path,
                    written,
                    order,
                });
                if let Some((_, first, first_path)) = other_case {
                    self.case_pairs.push(CasePair {
                        first,
                        second: output,
                        first_path: first_path.into(),
                        second_path: path.into(),
                    });
                }
            }
        }
        Ok(())
    }

    pub(crate) fn finish(self) -> Duplicates<'d, T> {
        Duplicates {
            destination: self.destination,
            by_path: self.duplicates,
            case_pairs: self.case_pairs,
        }
    }
}

fn add_duplicate<T: Copy>(
    by_path: &mut StringArrayHashMap<Vec<T>>,
    first_path: &[u8],
    first: T,
    output: T,
) -> Result<(), AllocError> {
    let outputs = by_path.get_or_put(first_path)?.value_ptr;
    if outputs.is_empty() {
        outputs.push(first);
    }
    outputs.push(output);
    Ok(())
}

/// The outputs of a build that share a file with an earlier output.
pub(crate) struct Duplicates<'d, T> {
    destination: Destination<'d>,
    /// The outputs at one file, under the path as the first of them spells it.
    by_path: StringArrayHashMap<Vec<T>>,
    case_pairs: Vec<CasePair<T>>,
}

impl<T: Copy> Duplicates<'_, T> {
    /// Adds the outputs whose paths differ only in ASCII case, if the output directory stores them as one file.
    /// `bytes_differ` says if bun writes different bytes for two outputs: equal bytes lose nothing. Returns the
    /// note for the error if it added any.
    pub(crate) fn add_case_pairs(
        &mut self,
        mut bytes_differ: impl FnMut([T; 2]) -> Result<bool, AllocError>,
    ) -> Result<Option<Vec<u8>>, AllocError> {
        let Destination::Directory(root) = self.destination else {
            return Ok(None);
        };
        let mut note: Option<Vec<u8>> = None;
        for pair in std::mem::take(&mut self.case_pairs) {
            if !bytes_differ([pair.first, pair.second])? {
                continue;
            }
            // The first pair asks the directory for the build.
            if note.is_none() {
                let [first, second] = [&pair.first_path, &pair.second_path]
                    .map(|path| output_path_key(self.destination, path));
                if !is_one_file(root, &first, &second) {
                    break;
                }
                note = Some(
                    [
                        b"the output directory stores '".as_slice(),
                        &pair.first_path,
                        b"' and '",
                        &pair.second_path,
                        b"' as one file",
                    ]
                    .concat(),
                );
            }
            add_duplicate(&mut self.by_path, &pair.first_path, pair.first, pair.second)?;
        }
        Ok(note)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.by_path.count() == 0
    }

    /// Writes the error. `input` is the input file of an output, if it has one.
    pub(crate) fn write_error<'i>(
        &self,
        msg: &mut Vec<u8>,
        mut input: impl FnMut(T) -> Option<&'i [u8]>,
    ) -> std::io::Result<()> {
        writeln!(msg, "Multiple files share the same output path")?;
        for (path, outputs) in self.by_path.keys().iter().zip(self.by_path.values()) {
            writeln!(msg, "  {}:", bstr::BStr::new(path))?;
            for &output in outputs {
                if let Some(input) = input(output) {
                    writeln!(msg, "    from input {}", bstr::BStr::new(input))?;
                }
            }
        }
        Ok(())
    }
}

/// Whether `a` and `b` are one file in the output directory `root`. The two differ only in ASCII case. The directory
/// itself answers: a volume decides if it tells `X` from `x`, not the host, and a link makes two names one file on
/// any volume.
fn is_one_file(root: &[u8], a: &[u8], b: &[u8]) -> bool {
    // A Windows volume ignores case unless a directory opted out, and a directory that does not exist yet cannot say.
    if cfg!(windows) {
        return true;
    }
    let [a, b] = [a, b].map(|key| ZBox::from_vec([root, b"/", key].concat()));
    match (find(a.as_zstr()), find(b.as_zstr())) {
        (Ok(Some(a)), Ok(Some(b))) => return is_same_file(&a, &b),
        (Ok(None), Ok(None)) => {}
        // One name exists alone, or the directory gives no answer.
        _ => return false,
    }
    // A dangling link can hold the first name, so each name gets a turn.
    reserve(&a, &b).or_else(|| reserve(&b, &a)).unwrap_or(false)
}

/// The file at `path`, through links like the open of the writer. `None` if there is none.
fn find(path: &ZStr) -> bun_sys::Maybe<Option<bun_sys::Stat>> {
    match bun_sys::stat(path) {
        Ok(stat) => Ok(Some(stat)),
        Err(e) if e.get_errno() == E::ENOENT => Ok(None),
        Err(e) => Err(e),
    }
}

fn is_same_file(a: &bun_sys::Stat, b: &bun_sys::Stat) -> bool {
    a.st_dev == b.st_dev && a.st_ino == b.st_ino
}

/// Makes the file `name` and the directories it needs, says if `other` is that file, and removes what it made: a
/// build that fails leaves nothing behind. `None` if `name` cannot be made.
fn reserve(name: &ZBox, other: &ZBox) -> Option<bool> {
    let mut made: Vec<&[u8]> = Vec::new();
    let parent = path::resolve_path::dirname::<path::platform::Posix>(name.as_bytes());
    let answer = path::ComponentIterator::init(parent, path::PathFormat::Posix)
        .ok()
        .and_then(|directories| {
            path::make_path_with(directories, |directory| {
                match bun_sys::mkdir(ZBox::from_bytes(directory).as_zstr(), 0o777) {
                    Ok(()) => {
                        made.push(directory);
                        Ok(path::MakePathStep::Created)
                    }
                    Err(e) if e.get_errno() == E::EEXIST => Ok(path::MakePathStep::Exists),
                    Err(e) if e.get_errno() == E::ENOENT => Ok(path::MakePathStep::NotFound(e)),
                    Err(e) => Err(e),
                }
            })
            .ok()
        })
        .and_then(|()| {
            bun_sys::File::open(name.as_zstr(), O::WRONLY | O::CREAT | O::EXCL, 0o644).ok()
        })
        .map(|file| {
            let is_one_file = matches!(
                (file.stat(), find(other.as_zstr())),
                (Ok(made), Ok(Some(found))) if is_same_file(&made, &found)
            );
            drop(file);
            let _ = bun_sys::unlink(name.as_zstr());
            is_one_file
        });
    for directory in made.iter().rev() {
        let _ = bun_sys::rmdir(ZBox::from_bytes(directory).as_zstr());
    }
    answer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_path_key_is_one_per_file() {
        for destination in [Destination::Directory(b"out"), Destination::Returned] {
            let key = |path: &'static [u8]| output_path_key(destination, path);
            assert_eq!(key(b"./sub/x.js"), key(b"sub/x.js"));
            assert_eq!(key(b"././x.js"), key(b"x.js"));
            assert_eq!(key(b".//x.js"), key(b"x.js"));
            assert_eq!(key(b"sub/./x.js"), key(b"sub/x.js"));
            assert_eq!(key(b"assets/../x.js"), key(b"x.js"));
            assert_eq!(key(b"../x.js"), key(b"./../x.js"));
            assert_ne!(key(b"../x.js"), key(b"x.js"));
            assert_ne!(key(b"..x.js"), key(b"x.js"));
            // `\` is a byte of a name.
            assert_eq!(key(br"sub/../weird\dir/x.js"), key(br"weird\dir/x.js"));
            assert_ne!(key(br"assets/./a\b.png"), key(b"assets/a/b.png"));
            assert_ne!(key(br"sub\..\x.js"), key(b"x.js"));
            assert_ne!(key(b"Logo.png"), key(b"logo.png"));
        }
        let key = |path: &'static [u8]| output_path_key(Destination::Executable, path);
        assert_eq!(key(b"./x.js"), key(b"x.js"));
        assert_ne!(key(b"././x.js"), key(b"x.js"));
        assert_ne!(key(b"assets/../x.js"), key(b"x.js"));
    }

    /// Claims `paths` in order, each output named by its index. Returns the outputs at each shared path, and the
    /// pairs whose paths differ only in case.
    fn claim_all(
        destination: Destination<'_>,
        paths: &[&'static [u8]],
        inlined: &[usize],
    ) -> (Vec<(Vec<u8>, Vec<usize>)>, Vec<[usize; 2]>) {
        let mut output_paths = OutputPaths::with_capacity(destination, 1);
        for (output, path) in paths.iter().enumerate() {
            if inlined.contains(&output) {
                output_paths.claim_inlined(output, path).unwrap();
            } else {
                output_paths.claim(output, path, |_| false).unwrap();
            }
        }
        let duplicates = output_paths.finish();
        let by_path = (duplicates.by_path.keys().iter())
            .zip(duplicates.by_path.values())
            .map(|(path, outputs)| (path.to_vec(), outputs.clone()))
            .collect();
        let case_pairs = (duplicates.case_pairs.iter())
            .map(|pair| [pair.first, pair.second])
            .collect();
        (by_path, case_pairs)
    }

    #[test]
    fn a_directory_pairs_paths_that_differ_only_in_ascii_case() {
        let paths: &[&[u8]] = &[
            b"./Logo.png",
            b"logo.png",
            b"./logo.png",
            b"LOGO.png",
            b"sub/x.js",
            b"Sub/x.js",
            b"\xc3\x89.png",
            b"\xc3\xa9.png",
            b"logo.pn",
        ];
        let (by_path, case_pairs) = claim_all(Destination::Directory(b"out"), paths, &[]);
        // An equal path is a duplicate, also when it is not the first spelling.
        assert_eq!(by_path, [(b"logo.png".to_vec(), vec![1, 2])]);
        // Every spelling pairs with the first one. `É` and `é` are not ASCII.
        assert_eq!(case_pairs, [[0, 1], [0, 3], [4, 5]]);
    }

    #[test]
    fn only_written_outputs_pair() {
        let paths: &[&[u8]] = &[b"Logo.png", b"logo.png", b"LOGO.png", b"Logo.png"];
        for destination in [Destination::Returned, Destination::Executable] {
            let (by_path, case_pairs) = claim_all(destination, paths, &[]);
            assert_eq!(by_path, [(b"Logo.png".to_vec(), vec![0, 3])]);
            assert_eq!(case_pairs, [[0usize; 2]; 0]);
        }
        let (by_path, case_pairs) = claim_all(Destination::Directory(b"out"), paths, &[0]);
        assert_eq!(by_path, [(b"Logo.png".to_vec(), vec![0, 3])]);
        assert_eq!(case_pairs, [[1, 2]]);
    }

    #[test]
    fn claims_survive_growth() {
        let names: Vec<Vec<u8>> = (0..200)
            .flat_map(|i| [format!("Entry{i}.js"), format!("entry{i}.js")])
            .map(String::into_bytes)
            .collect();
        let mut output_paths = OutputPaths::with_capacity(Destination::Directory(b"out"), 1);
        for (output, name) in names.iter().enumerate() {
            output_paths.claim(output, name, |_| false).unwrap();
        }
        let duplicates = output_paths.finish();
        assert!(duplicates.is_empty());
        let case_pairs: Vec<[usize; 2]> = (duplicates.case_pairs.iter())
            .map(|pair| [pair.first, pair.second])
            .collect();
        let expected: Vec<[usize; 2]> = (0..200).map(|i| [2 * i, 2 * i + 1]).collect();
        assert_eq!(case_pairs, expected);
    }
}
