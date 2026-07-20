//! Working-tree checkout from a [`PackIndex`](crate::pack::PackIndex).
//!
//! Walks the root tree breadth-first to collect every blob path, then writes
//! blobs in parallel. Directory creation is serialised in the walk (cheap) so
//! workers only ever `open(O_CREAT)` regular files.
//!
//! Path safety: tree entry names are attacker-controlled. We refuse any name
//! that is empty, `"."`, `".."`, contains `'/'` or NUL, or case-folds to
//! `".git"` (the last would let a malicious repo write into our own `.git` on
//! a case-insensitive FS — CVE-2014-9390 family). Symlinks are written as
//! regular files containing the target on platforms without `symlink`
//! (Windows by default); on Unix we call `symlink(2)`.

use crate::fs::{mkdirp, write_worktree_file};
use crate::index::IndexEntry;
use crate::odb::{Odb, TreeEntry, TreeIter};
use crate::pack::{Inflate, ObjKind};
use crate::{Error, Oid, Result};
use bun_threading::{Guarded, WorkPool};

const MODE_DIR: u32 = 0o040000;
const MODE_LINK: u32 = 0o120000;
const MODE_GITLINK: u32 = 0o160000;
const MODE_EXEC: u32 = 0o100755;

struct BlobJob {
    /// Absolute path bytes (POSIX `/`; `validate_name` already rejected
    /// separators inside components).
    path: Vec<u8>,
    oid: Oid,
    mode: u32,
    eol: Eol,
}

/// Materialise `tree` under `root` (absolute byte path). Returns one
/// [`IndexEntry`] per blob/symlink/gitlink in tree order so the caller can
/// write `.git/index` once all files are on disk.
pub(crate) fn checkout(odb: &Odb, tree: Oid, root: &[u8]) -> Result<Vec<IndexEntry>> {
    let mut inf = Inflate::new();
    let mut jobs: Vec<BlobJob> = Vec::new();
    let mut entries: Vec<IndexEntry> = Vec::new();
    walk(odb, tree, root, &mut inf, &mut jobs, &mut entries)?;

    struct Ctx<'a> {
        odb: &'a Odb,
        jobs: &'a [BlobJob],
        err: Guarded<Option<Error>>,
    }
    let ctx = Ctx {
        odb,
        jobs: &jobs,
        err: Guarded::new(None),
    };
    // `each` needs a `&mut [V: Copy]`; hand it indices.
    let mut indices: Vec<u32> = (0..jobs.len() as u32).collect();
    WorkPool::get().each(
        &ctx,
        |ctx, i: u32, _| {
            crate::pack::with_inflate(|inf| {
                let mut buf = Vec::new();
                let mut conv = Vec::new();
                if let Err(e) = write_blob(ctx.odb, &ctx.jobs[i as usize], inf, &mut buf, &mut conv)
                {
                    *ctx.err.lock() = Some(e);
                }
            });
        },
        &mut indices,
    );
    let Ctx { mut err, .. } = ctx;
    if let Some(e) = err.get_mut().take() {
        return Err(e);
    }
    Ok(entries)
}

fn walk(
    odb: &Odb,
    tree: Oid,
    dir: &[u8],
    inf: &mut Inflate,
    out: &mut Vec<BlobJob>,
    entries: &mut Vec<IndexEntry>,
) -> Result<()> {
    let root_len = dir.len();
    mkdirp(dir)?;
    // BFS with an explicit queue so we don't recurse a million frames on deep
    // trees. Each queue item owns its inflated tree bytes so iteration borrows
    // stable memory.
    let mut buf = Vec::new();
    let kind = odb.read(&tree, inf, &mut buf)?;
    if kind != ObjKind::Tree {
        return Err(Error::Pack(format!("{tree} is {kind:?}, not a tree")));
    }
    let mut queue: Vec<(Vec<u8>, Vec<u8>, Vec<Rule>)> = vec![(dir.to_vec(), buf, Vec::new())];
    while let Some((base, data, mut attrs)) = queue.pop() {
        if let Some(oid) = find_gitattributes(&data)? {
            let mut ab = Vec::new();
            if odb.read(&oid, inf, &mut ab)? == ObjKind::Blob {
                parse_attrs(&ab, &mut attrs);
            }
        }
        for entry in TreeIter::new(&data) {
            let TreeEntry { mode, name, oid } = entry?;
            validate_name(name)?;
            // validate_name rejected separators, NUL and dot-segments, so a
            // simple byte join cannot escape `base`.
            let mut path = Vec::with_capacity(base.len() + 1 + name.len());
            path.extend_from_slice(&base);
            path.push(b'/');
            path.extend_from_slice(name);
            match mode {
                MODE_DIR => {
                    mkdirp(&path)?;
                    let mut sub = Vec::new();
                    let k = odb.read(&oid, inf, &mut sub)?;
                    if k != ObjKind::Tree {
                        return Err(Error::Pack(format!("{oid} is {k:?}, not a tree")));
                    }
                    queue.push((path, sub, attrs.clone()));
                }
                MODE_GITLINK => {
                    // Submodule placeholder: create the empty dir and record
                    // the commit oid in the index (no blob to write).
                    mkdirp(&path)?;
                    entries.push(IndexEntry {
                        mode,
                        oid,
                        path: path[root_len + 1..].to_vec(),
                    });
                }
                _ => {
                    let eol = if mode == MODE_LINK {
                        Eol::None
                    } else {
                        eol_for(&attrs, name)
                    };
                    entries.push(IndexEntry {
                        mode,
                        oid,
                        path: path[root_len + 1..].to_vec(),
                    });
                    out.push(BlobJob {
                        path,
                        oid,
                        mode,
                        eol,
                    });
                }
            }
        }
    }
    Ok(())
}

/// Reject any tree-entry name that could resolve to a path component outside
/// the working tree or into `.git/` on **any** filesystem we might be writing
/// to. Mirrors git's `verify_path()` / `is_ntfs_dotgit()` / `is_hfs_dotgit()`
/// (path.c) — the CVE-2014-9390 family showed that a case-insensitive or
/// normalising FS turns several non-obvious spellings into `.git`, and writing
/// `.git/hooks/post-checkout` from a malicious tree is RCE.
///
/// We check NTFS *and* HFS+ rules unconditionally (git gates them on
/// `core.protectNTFS`/`core.protectHFS`, both default-on); a clone tool has no
/// config, and the only cost is rejecting a handful of pathological names that
/// no legitimate repo uses.
fn validate_name(name: &[u8]) -> Result<()> {
    if name.is_empty()
        || name == b"."
        || name == b".."
        || name.contains(&b'/')
        || name.contains(&b'\\')
        || name.contains(&0)
        // NTFS alternate data streams (`foo::$DATA`) and drive-letter syntax;
        // also blocks `.git::$INDEX_ALLOCATION`. Harmless to reject on POSIX.
        || name.contains(&b':')
        || is_ntfs_dotgit(name)
        || is_hfs_dotgit(name)
    {
        return Err(Error::UnsafePath(name.to_vec()));
    }
    Ok(())
}

/// NTFS canonicalisation: trailing `.`/` ` are stripped, and the 8.3 short
/// name `GIT~1` (and `~2`…) maps to whatever long name sorts first — which
/// for a fresh directory is `.git`. Case-insensitive.
fn is_ntfs_dotgit(name: &[u8]) -> bool {
    // Strip every trailing '.' or ' ' (NTFS does this on every component).
    let mut end = name.len();
    while end > 0 && matches!(name[end - 1], b'.' | b' ') {
        end -= 1;
    }
    let core = &name[..end];
    if core.eq_ignore_ascii_case(b".git") {
        return true;
    }
    // 8.3 short name: `git~` followed by one or more digits (no leading dot —
    // NTFS short names never carry one).
    if core.len() >= 5
        && core[..4].eq_ignore_ascii_case(b"git~")
        && core[4..].iter().all(u8::is_ascii_digit)
    {
        return true;
    }
    false
}

/// HFS+ decomposes names and **ignores** a fixed set of Unicode "ignorable"
/// code points when comparing — so `.g\u{200c}it` and `.git` are the same
/// directory. The set is exactly the one git's `is_hfs_dotgit` checks
/// (utf8.c): U+200C–200F, U+202A–202E, U+206A–206F, U+FEFF.
fn is_hfs_dotgit(name: &[u8]) -> bool {
    // Walk UTF-8, skipping ignorables, matching `.git` case-insensitively.
    const TARGET: &[u8] = b".git";
    let mut ti = 0usize;
    let mut i = 0usize;
    while i < name.len() {
        // The ignorable set is entirely 3-byte UTF-8 sequences (U+200C..U+206F
        // → E2 80/81 xx; U+FEFF → EF BB BF).
        if name.len() - i >= 3 {
            let s = &name[i..i + 3];
            let skip = matches!(
                s,
                // U+200C..=U+200F
                [0xe2, 0x80, 0x8c..=0x8f]
                // U+202A..=U+202E
                | [0xe2, 0x80, 0xaa..=0xae]
                // U+206A..=U+206F
                | [0xe2, 0x81, 0xaa..=0xaf]
                // U+FEFF (BOM)
                | [0xef, 0xbb, 0xbf]
            );
            if skip {
                i += 3;
                continue;
            }
        }
        if ti >= TARGET.len() {
            // More non-ignorable bytes after `.git` → not a match.
            return false;
        }
        if !name[i].eq_ignore_ascii_case(&TARGET[ti]) {
            return false;
        }
        ti += 1;
        i += 1;
    }
    ti == TARGET.len()
}

/// Line-ending treatment resolved from `.gitattributes` for one blob.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Eol {
    /// `-text` / `binary` / no matching rule — write bytes verbatim.
    None,
    /// `eol=lf` — convert CRLF → LF.
    Lf,
    /// `eol=crlf` — convert lone LF → CRLF.
    Crlf,
    /// Bare `text` with no explicit `eol=` — convert LF → CRLF only when the
    /// blob looks textual (no NUL bytes, no CRLF already present).
    Auto,
}

#[derive(Clone, Copy)]
enum EolAttr {
    Crlf,
    Lf,
}

#[derive(Clone)]
enum Pat {
    Any,
    Suffix(Vec<u8>),
    Exact(Vec<u8>),
}

impl Pat {
    fn parse(p: &[u8]) -> Option<Self> {
        // Only the subset we need: `*`, `*suffix`, exact name. Anything with
        // `/`, `**`, or a non-leading `*` falls back to verbatim writes.
        if p.contains(&b'/') || p.windows(2).any(|w| w == b"**") {
            return None;
        }
        if p == b"*" {
            return Some(Pat::Any);
        }
        if let Some(rest) = p.strip_prefix(b"*") {
            return if rest.contains(&b'*') {
                None
            } else {
                Some(Pat::Suffix(rest.to_vec()))
            };
        }
        if p.contains(&b'*') {
            return None;
        }
        Some(Pat::Exact(p.to_vec()))
    }

    fn matches(&self, name: &[u8]) -> bool {
        match self {
            Pat::Any => true,
            Pat::Suffix(s) => name.ends_with(s),
            Pat::Exact(e) => name == e.as_slice(),
        }
    }
}

#[derive(Clone)]
struct Rule {
    pat: Pat,
    /// `Some(true)` = `text`, `Some(false)` = `-text` / `binary`.
    text: Option<bool>,
    eol: Option<EolAttr>,
}

/// Scan a tree's entries for a regular-file `.gitattributes` blob (symlinked
/// `.gitattributes` is ignored, matching git's CVE-2021-21300 hardening).
fn find_gitattributes(tree: &[u8]) -> Result<Option<Oid>> {
    for entry in TreeIter::new(tree) {
        let TreeEntry { mode, name, oid } = entry?;
        if name == b".gitattributes"
            && mode != MODE_DIR
            && mode != MODE_GITLINK
            && mode != MODE_LINK
        {
            return Ok(Some(oid));
        }
    }
    Ok(None)
}

/// Parse a `.gitattributes` blob, appending rules to `out`. Rules from inner
/// directories are appended after their parent's, so a single forward scan in
/// [`eol_for`] yields git's nearest-wins / last-line-wins semantics. Only
/// `text`, `-text`, `binary`, `eol=crlf` and `eol=lf` are recognised
/// (`text=auto`, `!text`, `-eol` are intentionally out of scope).
fn parse_attrs(data: &[u8], out: &mut Vec<Rule>) {
    for line in data.split(|&b| b == b'\n') {
        let line = match line.last() {
            Some(b'\r') => &line[..line.len() - 1],
            _ => line,
        };
        let mut it = line
            .split(|&b| b == b' ' || b == b'\t')
            .filter(|s| !s.is_empty());
        let Some(pat) = it.next() else { continue };
        if pat.starts_with(b"#") {
            continue;
        }
        let Some(pat) = Pat::parse(pat) else { continue };
        let mut text = None;
        let mut eol = None;
        for tok in it {
            match tok {
                b"text" => text = Some(true),
                b"-text" | b"binary" => text = Some(false),
                b"eol=crlf" => eol = Some(EolAttr::Crlf),
                b"eol=lf" => eol = Some(EolAttr::Lf),
                _ => {}
            }
        }
        if text.is_some() || eol.is_some() {
            out.push(Rule { pat, text, eol });
        }
    }
}

fn eol_for(rules: &[Rule], name: &[u8]) -> Eol {
    let mut text: Option<bool> = None;
    let mut eol: Option<EolAttr> = None;
    for r in rules {
        if r.pat.matches(name) {
            if let Some(t) = r.text {
                text = Some(t);
            }
            if let Some(e) = r.eol {
                eol = Some(e);
            }
        }
    }
    match (text, eol) {
        (Some(false), _) => Eol::None,
        (_, Some(EolAttr::Crlf)) => Eol::Crlf,
        (_, Some(EolAttr::Lf)) => Eol::Lf,
        (Some(true), None) => Eol::Auto,
        (None, None) => Eol::None,
    }
}

/// `text` auto-detection: no NUL bytes and no existing CRLF.
fn is_text_auto(buf: &[u8]) -> bool {
    let mut prev_cr = false;
    for &b in buf {
        if b == 0 || (b == b'\n' && prev_cr) {
            return false;
        }
        prev_cr = b == b'\r';
    }
    true
}

/// In-place CRLF → LF. Lone CR is left untouched.
fn crlf_to_lf(buf: &mut Vec<u8>) {
    let mut w = 0;
    let mut i = 0;
    let len = buf.len();
    while i < len {
        if buf[i] == b'\r' && i + 1 < len && buf[i + 1] == b'\n' {
            i += 1;
        }
        buf[w] = buf[i];
        w += 1;
        i += 1;
    }
    buf.truncate(w);
}

/// LF → CRLF into `dst` (cleared first). LF already preceded by CR is left
/// alone so existing CRLF is not doubled.
fn lf_to_crlf(src: &[u8], dst: &mut Vec<u8>) {
    dst.clear();
    dst.reserve(src.len() + src.iter().filter(|&&b| b == b'\n').count());
    let mut prev_cr = false;
    for &b in src {
        if b == b'\n' && !prev_cr {
            dst.push(b'\r');
        }
        dst.push(b);
        prev_cr = b == b'\r';
    }
}

fn write_blob(
    odb: &Odb,
    job: &BlobJob,
    inf: &mut Inflate,
    buf: &mut Vec<u8>,
    conv: &mut Vec<u8>,
) -> Result<()> {
    let kind = odb.read(&job.oid, inf, buf)?;
    if kind != ObjKind::Blob {
        return Err(Error::Pack(format!("{} is {kind:?}, not a blob", job.oid)));
    }
    #[cfg(unix)]
    if job.mode == MODE_LINK {
        crate::fs::symlink(buf, &job.path)?;
        return Ok(());
    }
    let data: &[u8] = match job.eol {
        Eol::None => buf.as_slice(),
        Eol::Lf => {
            crlf_to_lf(buf);
            buf.as_slice()
        }
        Eol::Crlf => {
            lf_to_crlf(buf, conv);
            conv.as_slice()
        }
        Eol::Auto if is_text_auto(buf) => {
            lf_to_crlf(buf, conv);
            conv.as_slice()
        }
        Eol::Auto => buf.as_slice(),
    };
    let mode = if job.mode == MODE_EXEC { 0o755 } else { 0o644 };
    write_worktree_file(&job.path, data, mode)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_dotgit_spellings() {
        for bad in [
            &b".git"[..],
            b".GIT",
            b".Git",
            b".git ",
            b".git.",
            b".git . . ",
            b"GIT~1",
            b"git~1",
            b"GiT~42",
            // .g<ZWNJ>it
            b".g\xe2\x80\x8cit",
            // <BOM>.git
            b"\xef\xbb\xbf.git",
            // .git<LRO>
            b".git\xe2\x80\xad",
            b"..",
            b".",
            b"",
            b"a/b",
            b"a\\b",
            b"a:b",
            b"a\x00b",
        ] {
            assert!(validate_name(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn accepts_benign_names() {
        for ok in [
            &b".gitignore"[..],
            b".gitmodules",
            b".github",
            b"git~", // no digits
            b"git",
            b"a.git",
            b"normal_file.rs",
            // U+00E9 (é) — non-ignorable, must not be stripped
            b".g\xc3\xa9it",
        ] {
            assert!(validate_name(ok).is_ok(), "should accept {ok:?}");
        }
    }

    #[test]
    fn attrs_parse_and_match() {
        let mut rules = Vec::new();
        parse_attrs(
            b"# comment\n\
              *           text\n\
              *.bin       binary\n\
              *.sh        eol=lf\n\
              win.bat     eol=crlf\r\n\
              **/deep     eol=lf\n",
            &mut rules,
        );
        assert_eq!(eol_for(&rules, b"README"), Eol::Auto);
        assert_eq!(eol_for(&rules, b"a.bin"), Eol::None);
        assert_eq!(eol_for(&rules, b"run.sh"), Eol::Lf);
        assert_eq!(eol_for(&rules, b"win.bat"), Eol::Crlf);
        assert_eq!(eol_for(&rules, b"deep"), Eol::Auto); // `**` pattern ignored
        parse_attrs(b"*.sh -text\n", &mut rules);
        assert_eq!(eol_for(&rules, b"run.sh"), Eol::None); // later rule wins per-attribute
    }

    #[test]
    fn eol_conversions() {
        let mut out = Vec::new();
        lf_to_crlf(b"a\nb\r\nc\n", &mut out);
        assert_eq!(out, b"a\r\nb\r\nc\r\n");
        let mut v = b"a\r\nb\nc\r".to_vec();
        crlf_to_lf(&mut v);
        assert_eq!(v, b"a\nb\nc\r");
        assert!(is_text_auto(b"a\nb\n") && !is_text_auto(b"a\r\nb") && !is_text_auto(b"a\0b"));
    }
}
