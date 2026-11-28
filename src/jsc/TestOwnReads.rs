//! What a test file's own code read from the file system, as part of its input record.
//!
//! The JavaScript-facing file APIs (`node:fs` in all three forms, `Bun.file` and `Bun.write`,
//! `Bun.Glob`, `fs.watch`) and the runner's snapshot files report each look at a path on the JS
//! thread, when the call is made, so async work is credited to the file that started it. A look is
//! not taken then: it is observed the way validation repeats it, the first time the file writes to
//! the path or near it, or else when the record is written. So a read followed by the file's own
//! write keeps what the path held before the write. A stamp taken at the look and again after the
//! value proves the value is what the file saw; when it changed in between, as when a file in
//! another worker wrote the path, the record does not hold. A path the file wrote before it looked at it is
//! not an input, and neither is anything under a directory it created. What the file's writes left
//! at each path it wrote is a look too, taken when it ends: a reused file writes nothing, so its
//! record holds only while that is still there.
//!
//! The resolver's and the module loader's reads are not here: resolutions are asked again and
//! modules are hashed.

use std::io::Write as _;

use bun_collections::StringHashMap;

/// One way of looking at a path; validation looks again the same way and compares.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Look {
    /// The bytes.
    Content,
    /// Type, size and the owner's permission bits, following a symbolic link.
    Stat,
    /// The same, of the path itself.
    Lstat,
    /// Whether it exists.
    Exists,
    /// Whether `access` with the mode in `extra` (decimal) succeeds.
    Access,
    /// A symbolic link's target.
    Readlink,
    /// The canonical path.
    Realpath,
    /// The names and types of a directory's entries.
    List,
    /// The same, for every directory below it too.
    ListRecursive,
    /// Names, types and the bytes of every file below a directory (`fs.cp`).
    Tree,
    /// What a `Bun.Glob` scan from this directory matches. `extra` holds the pattern and options.
    Glob,
}

const LOOKS: [(Look, &str); 11] = [
    (Look::Content, "content"),
    (Look::Stat, "stat"),
    (Look::Lstat, "lstat"),
    (Look::Exists, "exists"),
    (Look::Access, "access"),
    (Look::Readlink, "readlink"),
    (Look::Realpath, "realpath"),
    (Look::List, "list"),
    (Look::ListRecursive, "listRecursive"),
    (Look::Tree, "tree"),
    (Look::Glob, "glob"),
];

impl Look {
    pub fn name(self) -> &'static str {
        LOOKS
            .iter()
            .find(|(look, _)| *look == self)
            .map_or("", |(_, name)| name)
    }

    pub fn from_name(name: &[u8]) -> Option<Look> {
        LOOKS
            .iter()
            .find(|(_, it)| it.as_bytes() == name)
            .map(|(look, _)| *look)
    }
}

pub struct Read {
    pub look: Look,
    /// Absolute.
    pub path: Box<[u8]>,
    pub extra: Box<[u8]>,
    /// `None` until observed.
    pub value: Option<Box<[u8]>>,
    /// What [`stamp`] gave when the file looked, to prove that the value observed later is the one
    /// it saw. `None` for a look at what the file's writes left.
    pub stamp: Option<Box<[u8]>>,
}

impl Read {
    /// Observes the look now, and returns whether what is there changed since the file looked:
    /// the stamp is taken again after the value, so an equal stamp proves the value is what the
    /// file saw.
    fn observe(&mut self, root: &Root) -> bool {
        self.value = Some(observe(root, self.look, &self.path, &self.extra));
        self.stamp
            .as_deref()
            .is_some_and(|then| *stamp(root, self.look, &self.path, &self.extra) != *then)
    }
}

/// What a write did to a path, which decides what is there afterwards because of the file's own code.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Wrote {
    /// Wrote or created the file at the path: its bytes are the file's own product.
    File,
    /// Removed the path, made it a new directory, or moved or copied a tree to it: whatever is at
    /// or below it afterwards is the file's own product.
    Tree,
    /// Changed only metadata, or made a directory that may have been there already: what is at or
    /// below it is not the file's product.
    Meta,
    /// Put a tree into a directory that was there and is not the file's product (an archive
    /// extracted or a tree copied into it): as [`Wrote::Meta`], what is at or below it is not the
    /// file's product, but the whole tree is what the write left there.
    Merge,
}

#[derive(Default)]
pub struct OwnReads {
    pub reads: Vec<Read>,
    /// The index in `reads` of each look, by look, path and `extra`.
    keys: StringHashMap<usize>,
    /// Absolute paths the file wrote, created or removed, as given and with the symbolic links of
    /// their parent resolved (a module's path is the resolved one, as `/private/tmp` on macOS).
    written: Vec<(Box<[u8]>, Wrote)>,
    /// Absolute paths, as given, that the file's calls wrote or tried to write, with the strongest
    /// effect that applied there (`None` when none did): what is there when the file ends is a look
    /// of the record, with [`AFTER_WRITE`] as its `extra`.
    touched: Vec<(Box<[u8]>, Option<Wrote>)>,
    /// The directories `fs.mkdtemp` made for the file: new names each run, so what is at or below
    /// them is never a look.
    created: Vec<Box<[u8]>>,
    /// A path the file looked at changed before its look was observed, so the record may not hold
    /// what the file saw: another process wrote it, such as a file running in another worker.
    pub changed: bool,
}

/// The `extra` of a look at what the file's own writes left at a path when it ended. A record
/// holds only if that is still there: when the file is reused instead of run, nothing writes it
/// again, and a later file may read it.
pub const AFTER_WRITE: &[u8] = b"after";

/// Where the kernel's walk of a path lands, and the symbolic links on the way that the file did not
/// make: a change to one of those changes where a look lands.
struct Landing {
    path: Vec<u8>,
    links: Vec<Vec<u8>>,
}

/// As many symbolic links as Linux follows in one walk; past that the walk fails with `ELOOP`.
const MAX_LINKS: u32 = 40;

/// `path` with the symbolic links of its parent directory resolved, when that changes it.
fn real_parent(path: &[u8]) -> Option<Vec<u8>> {
    let split = path.iter().rposition(|&c| bun_paths::is_sep(c))?;
    let (parent, name) = (&path[..split.max(1)], &path[split + 1..]);
    let zparent = bun_core::ZBox::from_vec(parent.to_vec());
    let mut buf = bun_paths::path_buffer_pool::get();
    let real: &[u8] = bun_sys::realpath(&zparent, &mut buf).ok()?;
    if real == parent {
        return None;
    }
    let mut out = real.to_vec();
    if !out.last().is_some_and(|&c| bun_paths::is_sep(c)) {
        out.push(bun_paths::SEP);
    }
    out.extend_from_slice(name);
    Some(out)
}

/// The directory a record's paths are relative to, as given and with its symbolic links resolved:
/// a module's path is the resolved one, a path the test's code passes may be either.
pub struct Root {
    pub given: Box<[u8]>,
    pub real: Box<[u8]>,
}

impl Root {
    pub fn new(given: &[u8]) -> Root {
        let zgiven = bun_core::ZBox::from_vec(given.to_vec());
        let mut buf = bun_paths::path_buffer_pool::get();
        let real: Box<[u8]> = match bun_sys::realpath(&zgiven, &mut buf) {
            Ok(real) => Box::from(real),
            Err(_) => Box::from(given),
        };
        Root {
            given: Box::from(given),
            real,
        }
    }

    /// `path` relative to the root, if it is under it: the root itself is `.`, and `./` with a
    /// separator after it.
    pub fn relative<'p>(&self, path: &'p [u8]) -> Option<&'p [u8]> {
        [&*self.given, &*self.real].into_iter().find_map(|root| {
            let rest = path.strip_prefix(root)?;
            if rest.is_empty() {
                return Some(&b"."[..]);
            }
            if root.last().is_some_and(|&c| bun_paths::is_sep(c)) {
                return Some(rest);
            }
            if !bun_paths::is_sep(rest[0]) {
                return None;
            }
            Some(if rest.len() == 1 {
                &b"./"[..]
            } else {
                &rest[1..]
            })
        })
    }
}

/// `inner` is `outer` or below it.
fn under(inner: &[u8], outer: &[u8]) -> bool {
    match inner.strip_prefix(outer) {
        Some(rest) => {
            rest.is_empty()
                || bun_paths::is_sep(rest[0])
                || outer.last().is_some_and(|&c| bun_paths::is_sep(c))
        }
        None => false,
    }
}

impl OwnReads {
    /// Whether what is at `path` now is the product of the file's own writes so far: a file it
    /// wrote, or a path in a tree it removed, made new or replaced.
    pub fn generated(&self, path: &[u8]) -> bool {
        self.written.iter().any(|(written, wrote)| match wrote {
            Wrote::File => **written == *path,
            Wrote::Tree => under(path, written),
            Wrote::Meta | Wrote::Merge => false,
        })
    }

    /// Whether `path` is at or below something the file wrote: a look there may go through a
    /// symbolic link the file made.
    fn reaches_written(&self, path: &[u8]) -> bool {
        self.written.iter().any(|(written, wrote)| {
            matches!(wrote, Wrote::File | Wrote::Tree) && under(path, written)
        })
    }

    fn land(&self, path: &[u8], follow_last: bool) -> Option<Landing> {
        land(path, follow_last, &|path| self.generated(path))
    }

    /// Notes a look at the absolute `path`, unless what is there is the file's own product. A path
    /// at or below something the file wrote, or with a `..` in it, is walked now, as the kernel
    /// walks it: what a symbolic link leads to is looked at where it lands (a `..` after a link goes
    /// up from where the link led), and every link on the way that the file did not make is an
    /// input too. Returns `false` when the walk met more links than the kernel follows, which the
    /// record can't repeat.
    pub fn read(&mut self, root: &Root, look: Look, path: &[u8], extra: &[u8]) -> bool {
        if !has_dotdot(path) && !self.reaches_written(path) {
            self.note(root, look, path, extra);
            return true;
        }
        // `lstat` and `readlink` look at the last component itself.
        let follow_last = !matches!(look, Look::Lstat | Look::Readlink);
        let Some(landing) = self.land(path, follow_last) else {
            return false;
        };
        for link in &landing.links {
            self.note(root, Look::Readlink, link, b"");
        }
        if !self.generated(&landing.path) {
            self.note(root, look, &landing.path, extra);
        }
        true
    }

    fn note(&mut self, root: &Root, look: Look, path: &[u8], extra: &[u8]) {
        if self.generated(path) {
            return;
        }
        let mut key = Vec::with_capacity(path.len() + extra.len() + 16);
        key.extend_from_slice(look.name().as_bytes());
        key.push(0);
        key.extend_from_slice(path);
        key.push(0);
        key.extend_from_slice(extra);
        if let Some(&index) = self.keys.get(&*key) {
            // Observed already, at a write nearby: the file looks again now, and what it sees now
            // is what the record holds only if the path is as it was then.
            let read = &self.reads[index];
            if read.value.is_some()
                && let Some(then) = read.stamp.as_deref()
            {
                self.changed |= *stamp(root, look, path, extra) != *then;
            }
            return;
        }
        bun_core::handle_oom(self.keys.put(&key, self.reads.len()));
        self.reads.push(Read {
            look,
            path: Box::from(path),
            extra: Box::from(extra),
            value: None,
            stamp: Some(stamp(root, look, path, extra)),
        });
    }

    /// [`Self::before_write`] and [`Self::wrote`] at once, for a write that is not undone when it fails.
    pub fn write(&mut self, root: &Root, path: &[u8], wrote: Wrote) {
        self.before_write(root, path);
        self.wrote(path, wrote);
    }

    /// Before the file writes to `path`: what it looked at there, below it, or above it is observed
    /// now, so the record keeps what was there before the write.
    pub fn before_write(&mut self, root: &Root, path: &[u8]) {
        for read in self.reads.iter_mut().filter(|read| read.value.is_none()) {
            if under(&read.path, path) || under(path, &read.path) {
                self.changed |= read.observe(root);
            }
        }
        if !self.touched.iter().any(|(it, _)| **it == *path) {
            self.touched.push((Box::from(path), None));
        }
    }

    /// `fs.mkdtemp` made the directory at `path` for the file: what is at or below it is the
    /// file's product.
    pub fn created(&mut self, path: &[u8]) {
        self.wrote(path, Wrote::Tree);
        self.created.push(Box::from(path));
    }

    /// After a write to `path` succeeded: what it left there is the file's product, as `wrote` says.
    pub fn wrote(&mut self, path: &[u8], wrote: Wrote) {
        if let Some((_, strongest)) = self.touched.iter_mut().find(|(it, _)| **it == *path)
            && !(wrote == Wrote::Meta && strongest.is_some())
        {
            *strongest = Some(wrote);
        }
        if matches!(wrote, Wrote::Meta | Wrote::Merge) {
            return;
        }
        let real = real_parent(path);
        for path in core::iter::once(path).chain(real.as_deref()) {
            if !self
                .written
                .iter()
                .any(|(written, was)| *was == wrote && **written == *path)
            {
                self.written.push((Box::from(path), wrote));
            }
        }
    }

    /// When the record is written: observes what was not observed yet, and what the file's writes
    /// left at each path it wrote or tried to write, outside the directories `fs.mkdtemp` made.
    /// Where no effect applied (the call failed, or its effect is not known, as a Blob writer's),
    /// what is there was an input already, so only its type, size and owner bits (`lstat`), which
    /// still see an output that went away. Else a symbolic link's target; where only metadata
    /// changed, the type and permission bits; else a directory's tree, or the bytes or the error.
    pub fn finish(&mut self, root: &Root) {
        for read in self.reads.iter_mut().filter(|read| read.value.is_none()) {
            self.changed |= read.observe(root);
        }
        let touched = core::mem::take(&mut self.touched);
        for (path, strongest) in touched {
            if self.created.iter().any(|created| under(&path, created)) {
                continue;
            }
            let look = if strongest.is_none() {
                Look::Lstat
            } else {
                match bun_sys::lstat(&bun_core::ZBox::from_vec(path.to_vec())) {
                    Ok(stat) => match stat.st_mode as u32 & bun_sys::S::IFMT as u32 {
                        kind if kind == bun_sys::S::IFLNK as u32 => Look::Readlink,
                        _ if strongest == Some(Wrote::Meta) => Look::Stat,
                        kind if kind == bun_sys::S::IFDIR as u32 => Look::Tree,
                        _ => Look::Content,
                    },
                    Err(_) => Look::Content,
                }
            };
            let value = observe(root, look, &path, AFTER_WRITE);
            self.reads.push(Read {
                look,
                path,
                extra: Box::from(AFTER_WRITE),
                value: Some(value),
                stamp: None,
            });
        }
    }
}

/// Whether `path` has a `..` component, which only a walk resolves: after a symbolic link it goes up
/// from where the link led, not from the link.
pub fn has_dotdot(path: &[u8]) -> bool {
    path.split(|&c| bun_paths::is_sep(c)).any(|it| it == b"..")
}

/// The absolute `path` with its `..` components taken where the kernel's walk takes them, now: what
/// comes before the last `..` is walked, what comes after it is kept as it is. Unchanged when it has
/// none, or the walk meets too many links.
pub fn walked(path: &[u8]) -> Vec<u8> {
    let parts: Vec<&[u8]> = path.split(|&c| bun_paths::is_sep(c)).collect();
    let Some(last) = parts.iter().rposition(|it| *it == b"..") else {
        return path.to_vec();
    };
    let head = parts[..=last].join(&bun_paths::SEP);
    let Some(landing) = land(&head, true, &|_| true) else {
        return path.to_vec();
    };
    let mut out = landing.path;
    for part in parts[last + 1..]
        .iter()
        .filter(|it| !it.is_empty() && **it != b".")
    {
        if !out.last().is_some_and(|&c| bun_paths::is_sep(c)) {
            out.push(bun_paths::SEP);
        }
        out.extend_from_slice(part);
    }
    out
}

/// Walks the absolute `path` the way the kernel does, now: component by component, following every
/// symbolic link (the last one too when `follow_last`), with `..` taken from where a link led. It
/// stops at the first component that is missing or is not a directory, since the walk fails there:
/// what is there decides the look. The links on the way that `made` does not claim are returned.
/// `None` past [`MAX_LINKS`] links.
fn land(path: &[u8], follow_last: bool, made: &dyn Fn(&[u8]) -> bool) -> Option<Landing> {
    let mut pending: Vec<Vec<u8>> = path
        .split(|&c| bun_paths::is_sep(c))
        .filter(|it| !it.is_empty() && *it != b".")
        .rev()
        .map(<[u8]>::to_vec)
        .collect();
    let mut at: Vec<u8> = vec![bun_paths::SEP];
    let mut links = Vec::new();
    let mut hops = 0;
    let join = |dir: &[u8], name: &[u8]| {
        let mut out = dir.to_vec();
        if !out.last().is_some_and(|&c| bun_paths::is_sep(c)) {
            out.push(bun_paths::SEP);
        }
        out.extend_from_slice(name);
        out
    };
    while let Some(name) = pending.pop() {
        if name == b"." {
            continue;
        }
        if name == b".." {
            if let Some(split) = at.iter().rposition(|&c| bun_paths::is_sep(c)) {
                at.truncate(split.max(1));
            }
            continue;
        }
        let next = join(&at, &name);
        if pending.is_empty() && !follow_last {
            return Some(Landing { path: next, links });
        }
        let znext = bun_core::ZBox::from_vec(next.clone());
        let Ok(stat) = bun_sys::lstat(&znext) else {
            return Some(Landing { path: next, links });
        };
        let kind = stat.st_mode as u32 & bun_sys::S::IFMT as u32;
        if kind == bun_sys::S::IFLNK as u32 {
            hops += 1;
            if hops > MAX_LINKS {
                return None;
            }
            let mut buf = bun_paths::path_buffer_pool::get();
            let Ok(len) = bun_sys::readlink(&znext, &mut buf[..]) else {
                return Some(Landing { path: next, links });
            };
            let target = buf[..len].to_vec();
            if !made(&next) {
                links.push(next);
            }
            if target.first().is_some_and(|&c| bun_paths::is_sep(c)) {
                at = vec![bun_paths::SEP];
            }
            pending.extend(
                target
                    .split(|&c| bun_paths::is_sep(c))
                    .filter(|it| !it.is_empty())
                    .rev()
                    .map(<[u8]>::to_vec),
            );
            continue;
        }
        at = next;
        if kind != bun_sys::S::IFDIR as u32 && !pending.is_empty() {
            return Some(Landing { path: at, links });
        }
    }
    Some(Landing { path: at, links })
}

/// Looks at `path` the way `look` says. The same call records and validates, so the two agree on
/// the encoding: a hex SHA-256 for bytes and listings, a short text for the rest, and the error's
/// name (such as `ENOENT`) when the look fails. Paths under `root` in a value are relative to it.
pub fn observe(root: &Root, look: Look, path: &[u8], extra: &[u8]) -> Box<[u8]> {
    let zpath = bun_core::ZBox::from_vec(path.to_vec());
    let error = |err: bun_sys::Error| -> Box<[u8]> { Box::from(err.name()) };
    let value: Vec<u8> = match look {
        Look::Content => content(&zpath),
        Look::Stat | Look::Lstat => {
            let stat = if look == Look::Stat {
                bun_sys::stat(&zpath)
            } else {
                bun_sys::lstat(&zpath)
            };
            match stat {
                Ok(stat) => describe(stat.st_mode as u32, stat.st_size as u64),
                Err(err) => return error(err),
            }
        }
        Look::Access => {
            let mode = core::str::from_utf8(extra)
                .ok()
                .and_then(|it| it.parse::<i32>().ok())
                .unwrap_or(0);
            match bun_sys::access(&zpath, mode) {
                Ok(()) => b"yes".to_vec(),
                Err(err) => return error(err),
            }
        }
        Look::Exists => {
            if bun_sys::stat(&zpath).is_ok() {
                b"yes".to_vec()
            } else {
                b"no".to_vec()
            }
        }
        Look::Readlink => {
            let mut buf = bun_paths::path_buffer_pool::get();
            match bun_sys::readlink(&zpath, &mut buf[..]) {
                Ok(len) => buf[..len].to_vec(),
                Err(err) => return error(err),
            }
        }
        Look::Realpath => {
            let mut buf = bun_paths::path_buffer_pool::get();
            match bun_sys::realpath(&zpath, &mut buf) {
                Ok(real) => from_root(root, real),
                Err(err) => return error(err),
            }
        }
        Look::List | Look::ListRecursive | Look::Tree => {
            let mut lines = Vec::new();
            if let Err(err) = list(path, b"", look, content, &mut lines) {
                return error(err);
            }
            lines.sort();
            hex(&crate::test_input_recorder::source_hash(&lines.concat()))
        }
        Look::Glob => match glob(root, path, extra) {
            Some(mut matches) => {
                matches.sort();
                let mut joined = Vec::new();
                for it in matches {
                    joined.extend_from_slice(&it);
                    joined.push(b'\n');
                }
                hex(&crate::test_input_recorder::source_hash(&joined))
            }
            None => b"error".to_vec(),
        },
    };
    value.into_boxed_slice()
}

/// What a look's value rests on, taken when the file looks and again after the value is observed:
/// when the two differ, the value may not be what the file saw. For the cheap looks it is the value
/// itself. For bytes it is the file's device, inode, size and modification and change times in
/// nanoseconds, which any write changes, so it also sees a write that restored the size or the
/// bytes; for a tree, the same for every file in it, with the names and types.
fn stamp(root: &Root, look: Look, path: &[u8], extra: &[u8]) -> Box<[u8]> {
    match look {
        Look::Content => file_stamp(&bun_core::ZBox::from_vec(path.to_vec())).into_boxed_slice(),
        Look::Tree => {
            let mut lines = Vec::new();
            if let Err(err) = list(path, b"", look, file_stamp, &mut lines) {
                return Box::from(err.name());
            }
            lines.sort();
            hex(&crate::test_input_recorder::source_hash(&lines.concat())).into_boxed_slice()
        }
        _ => observe(root, look, path, extra),
    }
}

/// A regular file's device, inode, size and times; what a content look takes of anything else.
fn file_stamp(path: &bun_core::ZStr) -> Vec<u8> {
    let stat = match bun_sys::stat(path) {
        Ok(stat) => stat,
        Err(err) => return err.name().to_vec(),
    };
    if stat.st_mode as u32 & bun_sys::S::IFMT as u32 != bun_sys::S::IFREG as u32 {
        return content(path);
    }
    let (modified, changed) = (bun_sys::stat_mtime(&stat), bun_sys::stat_ctime(&stat));
    format!(
        "{} {} {} {}.{} {}.{}",
        stat.st_dev,
        stat.st_ino,
        stat.st_size,
        modified.sec,
        modified.nsec,
        changed.sec,
        changed.nsec
    )
    .into_bytes()
}

/// A content look: the SHA-256 of a regular file's bytes, read in chunks so that memory stays
/// bounded whatever the size. Anything else (a device such as `/dev/stdout` or `/dev/urandom`, a
/// pipe, a directory) is never opened: its kind is the value. There is no size cap: a large file
/// costs time to hash, once per record and once per validation, not memory.
fn content(path: &bun_core::ZStr) -> Vec<u8> {
    let stat = match bun_sys::stat(path) {
        Ok(stat) => stat,
        Err(err) => return err.name().to_vec(),
    };
    let kind = stat.st_mode as u32 & bun_sys::S::IFMT as u32;
    if kind != bun_sys::S::IFREG as u32 {
        return if kind == bun_sys::S::IFDIR as u32 {
            b"directory".to_vec()
        } else {
            b"not a file".to_vec()
        };
    }
    // Non-blocking, in case the path became a pipe since the `stat`.
    let fd = match bun_sys::open(path, bun_sys::O::RDONLY | bun_sys::O::NONBLOCK, 0) {
        Ok(fd) => fd,
        Err(err) => return err.name().to_vec(),
    };
    let file = bun_sys::File::from_fd(fd);
    let mut hasher = bun_sha_hmac::sha::hashers::SHA256::init();
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        match bun_sys::read(file.handle, &mut chunk) {
            Ok(0) => break,
            Ok(n) => hasher.update(&chunk[..n]),
            Err(err) => return err.name().to_vec(),
        }
    }
    let mut sha256 = [0u8; 32];
    hasher.r#final(&mut sha256);
    hex(&sha256)
}

fn hex(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(64);
    crate::test_input_recorder::write_hex(&mut out, bytes);
    out
}

/// Type, size and the owner's permission bits: what a test asserts with `stat().mode` or
/// `access`, such as an executable bit, which git keeps. The group's and others' bits come from the
/// umask of the checkout, not from the repository, so they are left out and a record holds on a
/// machine with another umask. Times are never compared.
fn describe(mode: u32, size: u64) -> Vec<u8> {
    let kind = mode & bun_sys::S::IFMT as u32;
    let owner = mode & 0o700;
    if kind == bun_sys::S::IFREG as u32 {
        format!("file {size} {owner:o}").into_bytes()
    } else if kind == bun_sys::S::IFDIR as u32 {
        format!("directory {owner:o}").into_bytes()
    } else if kind == bun_sys::S::IFLNK as u32 {
        b"symlink".to_vec()
    } else {
        b"other".to_vec()
    }
}

fn from_root(root: &Root, path: &[u8]) -> Vec<u8> {
    match root.relative(path) {
        Some(b".") => b".".to_vec(),
        Some(b"./") => b"./".to_vec(),
        Some(rest) => {
            let mut out = b"./".to_vec();
            out.extend_from_slice(rest);
            out
        }
        None => path.to_vec(),
    }
}

/// One line per entry, `relative name, kind[, hash]`, for the directory at `path` (and, for the
/// recursive looks, every directory below it; symbolic links are not followed).
fn list(
    path: &[u8],
    prefix: &[u8],
    look: Look,
    file: fn(&bun_core::ZStr) -> Vec<u8>,
    lines: &mut Vec<Vec<u8>>,
) -> bun_sys::Result<()> {
    let fd = bun_sys::open_dir_for_iteration(bun_sys::Fd::cwd(), path)?;
    let dir = bun_sys::File::from_fd(fd);
    let mut entries = Vec::new();
    let mut iterator = bun_sys::dir_iterator::iterate(dir.handle);
    while let Some(entry) = iterator.next()? {
        entries.push((entry.name.slice_u8().to_vec(), entry.kind));
    }
    drop(dir);
    for (name, kind) in entries {
        let mut relative = prefix.to_vec();
        relative.extend_from_slice(&name);
        let mut line = relative.clone();
        let _ = write!(line, "\t{kind:?}");
        let mut child = path.to_vec();
        child.push(bun_paths::SEP);
        child.extend_from_slice(&name);
        let is_dir = matches!(kind, bun_sys::EntryKind::Directory);
        if look == Look::Tree && matches!(kind, bun_sys::EntryKind::File) {
            line.push(b'\t');
            line.extend_from_slice(&file(&bun_core::ZBox::from_vec(child.clone())));
        }
        line.push(b'\n');
        lines.push(line);
        if is_dir && look != Look::List {
            relative.push(b'/');
            list(&child, &relative, look, file, lines)?;
        }
    }
    Ok(())
}

/// The options of a `Bun.Glob` scan, as `extra` carries them after the pattern and a NUL.
pub struct GlobOptions {
    pub dot: bool,
    pub absolute: bool,
    pub only_files: bool,
    pub follow_symlinks: bool,
    pub error_on_broken_symlinks: bool,
}

pub fn glob_extra(pattern: &[u8], options: &GlobOptions) -> Vec<u8> {
    let mut extra = pattern.to_vec();
    extra.push(0);
    for (on, letter) in [
        (options.dot, b'd'),
        (options.absolute, b'a'),
        (options.only_files, b'f'),
        (options.follow_symlinks, b'l'),
        (options.error_on_broken_symlinks, b'e'),
    ] {
        if on {
            extra.push(letter);
        }
    }
    extra
}

fn glob(root: &Root, cwd: &[u8], extra: &[u8]) -> Option<Vec<Vec<u8>>> {
    let split = bun_core::strings::index_of_char_usize(extra, 0)?;
    let (pattern, flags) = (&extra[..split], &extra[split + 1..]);
    let has = |letter: u8| flags.contains(&letter);
    let mut walker =
        bun_glob::walk::GlobWalker::<bun_glob::walk::SyscallAccessor, false>::init_with_cwd(
            pattern,
            cwd,
            has(b'd'),
            has(b'a'),
            has(b'l'),
            has(b'e'),
            has(b'f'),
            None,
        )
        .ok()?
        .ok()?;
    walker.walk().ok()?.ok()?;
    Some(
        walker
            .matched_paths
            .keys()
            .iter()
            .map(|it| from_root(root, it))
            .collect(),
    )
}
