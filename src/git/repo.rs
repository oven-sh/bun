//! Repository discovery and access.
//!
//! Reference: `Documentation/gitrepository-layout.txt` (`.git` files with
//! `gitdir:` indirection, `commondir`), `setup.c:setup_git_directory_gently`.
//!
//! Discovery walks up from an absolute work-tree path looking for a `.git`
//! directory or a `.git` *file* (linked worktrees / submodules). For linked
//! worktrees the per-worktree state (`HEAD`, `index`) lives in the resolved
//! git dir while shared state (`objects`, `refs`, `packed-refs`) lives in
//! the common dir named by the `commondir` file.
//!
//! `GIT_DIR` / `GIT_INDEX_FILE` / `GIT_CEILING_DIRECTORIES` environment
//! overrides are intentionally ignored (documented v1 limitation).

use crate::error::GitError;
use crate::hash::verify_trailing_sha1;
use crate::index::Index;
use crate::odb::{ObjectKind, Odb};
use crate::oid::Oid;
use crate::refs::{Head, PackedRefs, RefFile, is_safe_ref_name, parse_ref_file};
use crate::tree::{TreeEntry, flatten_tree, parse_commit_tree, parse_tag_target};
use crate::util::{join_path, trim_line};
use bun_sys::{Dir, E, Fd, File, O};

/// `refs.c`: `MAXDEPTH 5` — symbolic-ref chains longer than this fail.
const MAX_SYMREF_DEPTH: usize = 5;
/// Bound on `tag -> tag -> ... -> commit` peeling when resolving HEAD.
const MAX_TAG_PEEL_DEPTH: usize = 8;
/// Sanity bound on paths read out of `.git` files / `commondir`.
const MAX_GITFILE_PATH: usize = 4096;

/// A discovered repository. All paths are absolute, `/`-separated byte
/// strings with no trailing slash.
pub struct Repository {
    work_tree: Vec<u8>,
    git_dir: Vec<u8>,
    common_dir: Vec<u8>,
}

impl Repository {
    /// Walk up from `worktree_root` (which must be an absolute path to a
    /// directory) looking for a repository. `Ok(None)` when none of its
    /// ancestors contain one.
    pub fn discover(worktree_root: &[u8]) -> Result<Option<Repository>, GitError> {
        if !is_absolute_path(worktree_root) {
            return Err(GitError::InvalidInput("worktree root must be absolute"));
        }
        let mut cur = strip_trailing_slashes(worktree_root).to_vec();
        loop {
            let dotgit = join_path(&cur, b".git");
            match Dir::open(&dotgit) {
                Ok(dir) => {
                    drop(dir);
                    if let Some(repo) = Repository::from_git_dir(dotgit, cur.clone())? {
                        return Ok(Some(repo));
                    }
                    // A `.git` directory that is not a real git dir (no
                    // HEAD): keep looking upward, like git does.
                }
                Err(err) if err.get_errno() == E::ENOENT => {}
                Err(err) if err.get_errno() == E::ENOTDIR => {
                    // `.git` is a regular file: `gitdir: <path>` indirection.
                    let contents = File::read_from(Fd::cwd(), &dotgit).map_err(GitError::Io)?;
                    let target = parse_gitfile(&contents)?;
                    let git_dir = if is_absolute_path(target) {
                        target.to_vec()
                    } else {
                        join_path(&cur, target)
                    };
                    return match Repository::from_git_dir(git_dir, cur)? {
                        Some(repo) => Ok(Some(repo)),
                        // git: "not a git repository: <.git file points at
                        // an invalid git dir>" is a hard error, not a miss.
                        None => Err(GitError::NotARepo),
                    };
                }
                Err(err) => return Err(err.into()),
            }
            match parent_dir(&cur).map(<[u8]>::to_vec) {
                Some(parent) if parent.len() < cur.len() => cur = parent,
                _ => return Ok(None),
            }
        }
    }

    /// Build a `Repository` from a candidate git dir. `Ok(None)` if it does
    /// not look like one (no readable `HEAD`).
    fn from_git_dir(git_dir: Vec<u8>, work_tree: Vec<u8>) -> Result<Option<Repository>, GitError> {
        match File::openat(Fd::cwd(), &join_path(&git_dir, b"HEAD"), O::RDONLY, 0) {
            Ok(_) => {}
            Err(err) if matches!(err.get_errno(), E::ENOENT | E::ENOTDIR) => return Ok(None),
            Err(err) => return Err(err.into()),
        }
        // `gitrepository-layout.txt`: if `$GIT_DIR/commondir` exists, the
        // (possibly relative to `$GIT_DIR`) path inside it is the common dir.
        let common_dir = match File::read_from(Fd::cwd(), &join_path(&git_dir, b"commondir")) {
            Ok(contents) => {
                let target = trim_line(&contents);
                if target.is_empty()
                    || target.len() > MAX_GITFILE_PATH
                    || memchr::memchr(0, target).is_some()
                {
                    return Err(GitError::Corrupt("commondir contents"));
                }
                if is_absolute_path(target) {
                    target.to_vec()
                } else {
                    join_path(&git_dir, target)
                }
            }
            Err(err) if matches!(err.get_errno(), E::ENOENT | E::ENOTDIR) => git_dir.clone(),
            Err(err) => return Err(err.into()),
        };
        Ok(Some(Repository {
            work_tree,
            git_dir,
            common_dir,
        }))
    }

    pub fn work_tree(&self) -> &[u8] {
        &self.work_tree
    }

    /// The per-worktree git dir (`HEAD`, `index`).
    pub fn git_dir(&self) -> &[u8] {
        &self.git_dir
    }

    /// The shared git dir (`objects`, `refs`, `packed-refs`). Equal to
    /// [`Repository::git_dir`] except in linked worktrees.
    pub fn common_dir(&self) -> &[u8] {
        &self.common_dir
    }

    pub fn head(&self) -> Result<Head, GitError> {
        let raw =
            File::read_from(Fd::cwd(), &join_path(&self.git_dir, b"HEAD")).map_err(GitError::Io)?;
        match parse_ref_file(&raw)? {
            RefFile::Direct(oid) => Ok(Head::Detached(oid)),
            RefFile::Symbolic(ref_name) => {
                let oid = self.resolve_ref(&ref_name)?;
                Ok(Head::Branch { ref_name, oid })
            }
        }
    }

    /// Resolve a fully-qualified ref (`refs/...`) through loose refs (in
    /// the common dir) and `packed-refs`. `Ok(None)` for an unborn ref.
    pub fn resolve_ref(&self, ref_name: &[u8]) -> Result<Option<Oid>, GitError> {
        if !is_safe_ref_name(ref_name) {
            return Err(GitError::Corrupt("ref: unsafe ref name"));
        }
        let mut name = ref_name.to_vec();
        for _ in 0..MAX_SYMREF_DEPTH {
            match File::read_from(Fd::cwd(), &join_path(&self.common_dir, &name)) {
                Ok(data) => match parse_ref_file(&data)? {
                    RefFile::Direct(oid) => return Ok(Some(oid)),
                    RefFile::Symbolic(next) => name = next,
                },
                // EISDIR: `refs/heads/x` exists only as a directory because
                // `refs/heads/x/y` exists; the ref itself does not.
                Err(err) if matches!(err.get_errno(), E::ENOENT | E::ENOTDIR | E::EISDIR) => {
                    return Ok(self.packed_refs()?.get(&name));
                }
                Err(err) => return Err(err.into()),
            }
        }
        Err(GitError::Corrupt("ref: symbolic ref chain too deep"))
    }

    /// The parsed `packed-refs` file (empty if absent).
    pub fn packed_refs(&self) -> Result<PackedRefs, GitError> {
        match File::read_from(Fd::cwd(), &join_path(&self.common_dir, b"packed-refs")) {
            Ok(data) => PackedRefs::parse(&data),
            Err(err) if err.get_errno() == E::ENOENT => Ok(PackedRefs::empty()),
            Err(err) => Err(err.into()),
        }
    }

    /// Read and parse `$GIT_DIR/index`, verifying its trailing SHA-1. A
    /// missing index (fresh repository) yields an empty index. The index
    /// file's own mtime is recorded for the racily-clean check.
    pub fn read_index(&self) -> Result<Index, GitError> {
        let path = join_path(&self.git_dir, b"index");
        let file = match File::openat(Fd::cwd(), &path, O::RDONLY, 0) {
            Ok(f) => f,
            Err(err) if err.get_errno() == E::ENOENT => return Ok(Index::empty()),
            Err(err) => return Err(err.into()),
        };
        let stat = file.stat().map_err(GitError::Io)?;
        let data = file.read_to_end().map_err(GitError::Io)?;
        verify_trailing_sha1(&data, "index checksum")?;
        let mut index = Index::parse(&data)?;
        let mtime = bun_sys::stat_mtime(&stat);
        // Nanoseconds are clamped, not truncated: only the seconds matter.
        index.set_timestamp(mtime.sec, mtime.nsec.clamp(0, 999_999_999) as u32);
        Ok(index)
    }

    /// Open the object database under the common dir.
    pub fn odb(&self) -> Result<Odb, GitError> {
        Odb::open(&self.common_dir)
    }

    /// HEAD's tree flattened to a path-sorted `(path, oid, mode)` list.
    /// An unborn HEAD yields an empty list. Annotated tags are peeled.
    pub fn head_tree(&self, odb: &Odb) -> Result<Vec<TreeEntry>, GitError> {
        let Some(mut oid) = self.head()?.oid() else {
            return Ok(Vec::new());
        };
        let mut body = Vec::new();
        let mut kind = odb.read(oid, &mut body)?;
        let mut peeled = 0;
        while kind == ObjectKind::Tag {
            peeled += 1;
            if peeled > MAX_TAG_PEEL_DEPTH {
                return Err(GitError::Corrupt("HEAD: tag chain too deep"));
            }
            oid = parse_tag_target(&body)?;
            kind = odb.read(oid, &mut body)?;
        }
        let tree_oid = match kind {
            ObjectKind::Commit => parse_commit_tree(&body)?,
            ObjectKind::Tree => oid,
            ObjectKind::Blob | ObjectKind::Tag => {
                return Err(GitError::Corrupt("HEAD does not point at a commit"));
            }
        };
        let mut read_tree = |o: Oid, out: &mut Vec<u8>| match odb.read(o, out)? {
            ObjectKind::Tree => Ok(()),
            _ => Err(GitError::Corrupt("tree entry does not name a tree")),
        };
        flatten_tree(tree_oid, &mut read_tree)
    }
}

/// `setup.c:read_gitfile_gently`: the file must start with `gitdir:`; the
/// rest of the first line (whitespace-trimmed) is the path.
fn parse_gitfile(contents: &[u8]) -> Result<&[u8], GitError> {
    let rest = contents
        .strip_prefix(b"gitdir:".as_slice())
        .ok_or(GitError::Corrupt(".git file: missing gitdir prefix"))?;
    let line = match memchr::memchr(b'\n', rest) {
        Some(nl) => &rest[..nl],
        None => rest,
    };
    let mut target = trim_line(line);
    while let Some((&first, tail)) = target.split_first() {
        if first == b' ' || first == b'\t' {
            target = tail;
        } else {
            break;
        }
    }
    if target.is_empty() || target.len() > MAX_GITFILE_PATH || memchr::memchr(0, target).is_some() {
        return Err(GitError::Corrupt(".git file: bad gitdir path"));
    }
    Ok(target)
}

/// POSIX absolute, or (on Windows) a drive-absolute / UNC path.
fn is_absolute_path(path: &[u8]) -> bool {
    if path.first() == Some(&b'/') {
        return true;
    }
    #[cfg(windows)]
    {
        if path.starts_with(b"\\\\")
            || (path.len() >= 3
                && path[0].is_ascii_alphabetic()
                && path[1] == b':'
                && (path[2] == b'/' || path[2] == b'\\'))
        {
            return true;
        }
    }
    false
}

fn strip_trailing_slashes(path: &[u8]) -> &[u8] {
    let mut len = path.len();
    while len > 1 && path[len - 1] == b'/' {
        len -= 1;
    }
    &path[..len]
}

/// Parent directory of a '/'-separated path, or `None` at a root.
fn parent_dir(path: &[u8]) -> Option<&[u8]> {
    let path = strip_trailing_slashes(path);
    let idx = memchr::memrchr(b'/', path)?;
    if idx == 0 {
        if path.len() == 1 {
            None
        } else {
            Some(&path[..1])
        }
    } else {
        Some(&path[..idx])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::{AtomicUsize, Ordering};

    const H1: &[u8] = b"1111111111111111111111111111111111111111";
    const H2: &[u8] = b"2222222222222222222222222222222222222222";
    const H3: &[u8] = b"3333333333333333333333333333333333333333";

    /// A unique directory under the OS temp dir, recursively deleted on
    /// drop. All file I/O goes through `bun_sys`.
    struct TempTree {
        parent: Vec<u8>,
        name: Vec<u8>,
        root: Vec<u8>,
    }

    impl TempTree {
        fn new(tag: &str) -> TempTree {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let parent = std::env::temp_dir().as_os_str().as_encoded_bytes().to_vec();
            let name = format!(
                "bun_git_test_{tag}_{}_{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            )
            .into_bytes();
            let root = join_path(&parent, &name);
            Dir::open(&parent)
                .expect("temp dir must exist")
                .make_path(&name)
                .expect("create test root");
            TempTree { parent, name, root }
        }

        fn path(&self, rel: &[u8]) -> Vec<u8> {
            join_path(&self.root, rel)
        }

        fn dir(&self, rel: &[u8]) {
            Dir::open(&self.root).unwrap().make_path(rel).unwrap();
        }

        fn file(&self, rel: &[u8], contents: &[u8]) {
            if let Some(slash) = memchr::memrchr(b'/', rel) {
                self.dir(&rel[..slash]);
            }
            let f = File::openat(
                Fd::cwd(),
                &self.path(rel),
                O::WRONLY | O::CREAT | O::TRUNC,
                0o644,
            )
            .unwrap();
            f.write_all(contents).unwrap();
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            if let Ok(dir) = Dir::open(&self.parent) {
                let _ = dir.delete_tree(&self.name);
            }
        }
    }

    fn line(hex: &[u8]) -> Vec<u8> {
        let mut v = hex.to_vec();
        v.push(b'\n');
        v
    }

    #[test]
    fn path_helpers() {
        assert!(is_absolute_path(b"/"));
        assert!(is_absolute_path(b"/a/b"));
        assert!(!is_absolute_path(b"a/b"));
        assert!(!is_absolute_path(b""));
        assert_eq!(strip_trailing_slashes(b"/a/b//"), b"/a/b");
        assert_eq!(strip_trailing_slashes(b"/"), b"/");
        assert_eq!(parent_dir(b"/a/b/c"), Some(b"/a/b".as_slice()));
        assert_eq!(parent_dir(b"/a/b/"), Some(b"/a".as_slice()));
        assert_eq!(parent_dir(b"/a"), Some(b"/".as_slice()));
        assert_eq!(parent_dir(b"/"), None);
        assert_eq!(parent_dir(b"rel/x"), Some(b"rel".as_slice()));
        assert_eq!(parent_dir(b"rel"), None);
    }

    #[test]
    fn gitfile_parsing() {
        assert_eq!(parse_gitfile(b"gitdir: /a/b\n").unwrap(), b"/a/b");
        assert_eq!(parse_gitfile(b"gitdir: ../x").unwrap(), b"../x");
        assert_eq!(parse_gitfile(b"gitdir:\t/a \n").unwrap(), b"/a");
        assert_eq!(
            parse_gitfile(b"gitdir: /a/b\nignored second line").unwrap(),
            b"/a/b"
        );
        for bad in [
            b"".as_slice(),
            b"gitdir:",
            b"gitdir: \n",
            b"GITDIR: /x",
            b"gitdir /x",
            b"gitdir: /a\x00b",
        ] {
            assert!(parse_gitfile(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn discover_rejects_relative_paths() {
        assert!(matches!(
            Repository::discover(b"relative/path"),
            Err(GitError::InvalidInput(_))
        ));
        assert!(matches!(
            Repository::discover(b""),
            Err(GitError::InvalidInput(_))
        ));
    }

    #[test]
    fn discover_plain_repo_from_root_and_subdir() {
        let t = TempTree::new("plain");
        t.file(b".git/HEAD", b"ref: refs/heads/main\n");
        t.dir(b"src/deep");
        let repo = Repository::discover(&t.root).unwrap().unwrap();
        assert_eq!(repo.work_tree(), &t.root[..]);
        assert_eq!(repo.git_dir(), &t.path(b".git")[..]);
        assert_eq!(repo.common_dir(), repo.git_dir());

        let nested = Repository::discover(&t.path(b"src/deep")).unwrap().unwrap();
        assert_eq!(nested.work_tree(), &t.root[..]);
        // A trailing slash on the input is tolerated.
        let mut slashed = t.root.clone();
        slashed.push(b'/');
        let repo = Repository::discover(&slashed).unwrap().unwrap();
        assert_eq!(repo.work_tree(), &t.root[..]);
    }

    #[test]
    fn discover_outside_any_repo() {
        let t = TempTree::new("none");
        t.dir(b"a/b");
        // The temp dir's own ancestors are not under our control; the only
        // sound assertion is that nothing inside the fixture was found.
        if let Some(repo) = Repository::discover(&t.path(b"a/b")).unwrap() {
            assert!(!repo.work_tree().starts_with(&t.root));
        }
    }

    #[test]
    fn discover_skips_a_dotgit_dir_without_head() {
        let t = TempTree::new("skip");
        t.file(b".git/HEAD", b"ref: refs/heads/main\n");
        t.dir(b"sub/.git"); // empty `.git` directory, not a git dir
        let repo = Repository::discover(&t.path(b"sub")).unwrap().unwrap();
        assert_eq!(repo.work_tree(), &t.root[..]);
    }

    #[test]
    fn discover_linked_worktree_with_gitdir_file_and_commondir() {
        let t = TempTree::new("worktree");
        // Main repository.
        t.file(b"main/.git/HEAD", b"ref: refs/heads/main\n");
        t.file(b"main/.git/refs/heads/main", &line(H1));
        let mut packed = Vec::new();
        packed.extend_from_slice(b"# pack-refs with: peeled fully-peeled sorted \n");
        packed.extend_from_slice(H2);
        packed.extend_from_slice(b" refs/heads/feature\n");
        t.file(b"main/.git/packed-refs", &packed);
        // Linked worktree metadata inside the main git dir.
        t.file(b"main/.git/worktrees/wt/HEAD", b"ref: refs/heads/feature\n");
        t.file(b"main/.git/worktrees/wt/commondir", b"../..\n");
        // The linked worktree itself: `.git` is a FILE.
        t.dir(b"linked");
        let mut gitfile = b"gitdir: ".to_vec();
        gitfile.extend_from_slice(&t.path(b"main/.git/worktrees/wt"));
        gitfile.push(b'\n');
        t.file(b"linked/.git", &gitfile);

        let repo = Repository::discover(&t.path(b"linked")).unwrap().unwrap();
        assert_eq!(repo.work_tree(), &t.path(b"linked")[..]);
        assert_eq!(repo.git_dir(), &t.path(b"main/.git/worktrees/wt")[..]);
        assert_eq!(
            repo.common_dir(),
            &join_path(&t.path(b"main/.git/worktrees/wt"), b"../..")[..]
        );
        // HEAD comes from the per-worktree dir; the ref resolves through
        // the COMMON dir's packed-refs.
        let head = repo.head().unwrap();
        assert_eq!(head.branch_name(), Some(b"feature".as_slice()));
        assert_eq!(head.oid(), Some(Oid::from_hex(H2).unwrap()));
        // The main work tree still resolves its own HEAD from a loose ref.
        let main = Repository::discover(&t.path(b"main")).unwrap().unwrap();
        assert_eq!(main.head().unwrap().oid(), Some(Oid::from_hex(H1).unwrap()));
    }

    #[test]
    fn discover_relative_gitdir_file() {
        let t = TempTree::new("relgitfile");
        t.file(b"main/.git/HEAD", &line(H1));
        t.file(b"sub/.git", b"gitdir: ../main/.git\n");
        let repo = Repository::discover(&t.path(b"sub")).unwrap().unwrap();
        assert_eq!(repo.work_tree(), &t.path(b"sub")[..]);
        assert_eq!(
            repo.git_dir(),
            &join_path(&t.path(b"sub"), b"../main/.git")[..]
        );
        assert_eq!(
            repo.head().unwrap(),
            Head::Detached(Oid::from_hex(H1).unwrap())
        );
    }

    #[test]
    fn discover_broken_gitdir_file_is_an_error() {
        let t = TempTree::new("badgitfile");
        t.dir(b"a");
        t.file(b"a/.git", b"this is not a gitfile\n");
        assert!(matches!(
            Repository::discover(&t.path(b"a")),
            Err(GitError::Corrupt(_))
        ));
        let t2 = TempTree::new("gonegitdir");
        t2.dir(b"b");
        t2.file(b"b/.git", b"gitdir: /does/not/exist/anywhere\n");
        assert!(matches!(
            Repository::discover(&t2.path(b"b")),
            Err(GitError::NotARepo)
        ));
    }

    #[test]
    fn head_detached_and_unborn() {
        let t = TempTree::new("heads");
        t.file(b".git/HEAD", &line(H3));
        let repo = Repository::discover(&t.root).unwrap().unwrap();
        assert_eq!(
            repo.head().unwrap(),
            Head::Detached(Oid::from_hex(H3).unwrap())
        );

        t.file(b".git/HEAD", b"ref: refs/heads/unborn\n");
        let head = repo.head().unwrap();
        assert_eq!(head.oid(), None);
        assert_eq!(head.branch_name(), Some(b"unborn".as_slice()));
    }

    #[test]
    fn loose_ref_shadows_packed_ref() {
        let t = TempTree::new("shadow");
        t.file(b".git/HEAD", b"ref: refs/heads/main\n");
        let mut packed = Vec::new();
        packed.extend_from_slice(H2);
        packed.extend_from_slice(b" refs/heads/main\n");
        packed.extend_from_slice(H3);
        packed.extend_from_slice(b" refs/tags/only-packed\n");
        t.file(b".git/packed-refs", &packed);
        let repo = Repository::discover(&t.root).unwrap().unwrap();
        // Only packed: comes from packed-refs.
        assert_eq!(
            repo.resolve_ref(b"refs/tags/only-packed").unwrap(),
            Some(Oid::from_hex(H3).unwrap())
        );
        assert_eq!(repo.head().unwrap().oid(), Some(Oid::from_hex(H2).unwrap()));
        // Now add the loose ref: it wins over packed-refs.
        t.file(b".git/refs/heads/main", &line(H1));
        assert_eq!(repo.head().unwrap().oid(), Some(Oid::from_hex(H1).unwrap()));
        // Absent everywhere.
        assert_eq!(repo.resolve_ref(b"refs/heads/nope").unwrap(), None);
    }

    #[test]
    fn symbolic_ref_chain_and_loop() {
        let t = TempTree::new("symref");
        t.file(b".git/HEAD", b"ref: refs/heads/alias\n");
        t.file(b".git/refs/heads/alias", b"ref: refs/heads/real\n");
        t.file(b".git/refs/heads/real", &line(H1));
        let repo = Repository::discover(&t.root).unwrap().unwrap();
        assert_eq!(repo.head().unwrap().oid(), Some(Oid::from_hex(H1).unwrap()));

        t.file(b".git/refs/heads/loop_a", b"ref: refs/heads/loop_b\n");
        t.file(b".git/refs/heads/loop_b", b"ref: refs/heads/loop_a\n");
        assert!(matches!(
            repo.resolve_ref(b"refs/heads/loop_a"),
            Err(GitError::Corrupt("ref: symbolic ref chain too deep"))
        ));
    }

    #[test]
    fn resolve_ref_rejects_unsafe_names() {
        let t = TempTree::new("unsafe");
        t.file(b".git/HEAD", &line(H1));
        let repo = Repository::discover(&t.root).unwrap().unwrap();
        for bad in [
            b"refs/../escape".as_slice(),
            b"/etc/passwd",
            b"refs/heads/..",
            b"",
            b"config",
        ] {
            assert!(repo.resolve_ref(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn corrupt_head_is_an_error() {
        let t = TempTree::new("badhead");
        t.file(b".git/HEAD", b"total garbage\n");
        let repo = Repository::discover(&t.root).unwrap().unwrap();
        assert!(matches!(repo.head(), Err(GitError::Corrupt(_))));
    }
}
