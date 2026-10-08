//! Bring-up only: what `bun build --compile-aot` hands to the checker, written to a file, so that the standalone tool can repeat the
//! analysis of a bundle without the bundler.

use crate::host::AlreadyRead;
use bun_sema::resolve::ScriptKind;
use bun_sema::util::FxHashMap;

/// What the bundler has resolved each import to, by the importing file and the specifier. The paths are in the checker's format.
pub type Resolved = FxHashMap<(Vec<u8>, Vec<u8>), Vec<u8>>;

#[derive(Default)]
pub struct Snapshot {
    pub cwd: Vec<u8>,
    pub tsconfig: Option<Vec<u8>>,
    pub conditions: Vec<Box<[u8]>>,
    /// `Request::paths`
    pub entry_points: Vec<Vec<u8>>,
    /// `Request::code`
    pub code: Vec<Vec<u8>>,
    pub script_kinds: Vec<(Vec<u8>, ScriptKind)>,
    pub script_kinds_by_extension: Vec<(Vec<u8>, ScriptKind)>,
    pub already_read: AlreadyRead,
    pub resolved: Resolved,
    pub dropped_imports: Vec<(Vec<u8>, Vec<u8>)>,
    pub texts: Vec<(Vec<u8>, Vec<u8>)>,
    pub assets: Vec<(Vec<u8>, Vec<u8>)>,
    pub defines: Vec<(Vec<u8>, Vec<u8>)>,
    pub features: Vec<Vec<u8>>,
}

const MAGIC: &[u8] = b"bun aot snapshot 4\n";

fn put(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

fn put_count(out: &mut Vec<u8>, count: usize) {
    out.extend_from_slice(&(count as u32).to_le_bytes());
}

fn put_kinds(out: &mut Vec<u8>, kinds: &[(Vec<u8>, ScriptKind)]) {
    put_count(out, kinds.len());
    for (name, kind) in kinds {
        put(out, name);
        out.push(match kind {
            ScriptKind::Js => 0,
            ScriptKind::Jsx => 1,
            ScriptKind::Ts => 2,
            ScriptKind::Tsx => 3,
        });
    }
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn count(&mut self) -> Option<usize> {
        let (head, rest) = self.0.split_at_checked(4)?;
        self.0 = rest;
        Some(u32::from_le_bytes(head.try_into().ok()?) as usize)
    }
    fn bytes(&mut self) -> Option<Vec<u8>> {
        let length = self.count()?;
        let (head, rest) = self.0.split_at_checked(length)?;
        self.0 = rest;
        Some(head.to_vec())
    }
    fn list(&mut self) -> Option<Vec<Vec<u8>>> {
        (0..self.count()?).map(|_| self.bytes()).collect()
    }
    fn kinds(&mut self) -> Option<Vec<(Vec<u8>, ScriptKind)>> {
        (0..self.count()?)
            .map(|_| {
                let name = self.bytes()?;
                let (&kind, rest) = self.0.split_first()?;
                self.0 = rest;
                Some((name, [ScriptKind::Js, ScriptKind::Jsx, ScriptKind::Ts, ScriptKind::Tsx][usize::from(kind & 3)]))
            })
            .collect()
    }
}

impl Snapshot {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = MAGIC.to_vec();
        put(&mut out, &self.cwd);
        put_count(&mut out, usize::from(self.tsconfig.is_some()));
        put(&mut out, self.tsconfig.as_deref().unwrap_or_default());
        put_count(&mut out, self.conditions.len());
        for condition in &self.conditions {
            put(&mut out, condition);
        }
        for list in [&self.entry_points, &self.code] {
            put_count(&mut out, list.len());
            for path in list {
                put(&mut out, path);
            }
        }
        put_kinds(&mut out, &self.script_kinds);
        put_kinds(&mut out, &self.script_kinds_by_extension);
        let mut files: Vec<_> = self.already_read.iter().collect();
        files.sort();
        put_count(&mut out, files.len());
        for (path, text) in files {
            put(&mut out, path);
            put(&mut out, text);
        }
        let mut imports: Vec<_> = self.resolved.iter().collect();
        imports.sort();
        put_count(&mut out, imports.len());
        for ((from, specifier), to) in imports {
            put(&mut out, from);
            put(&mut out, specifier);
            put(&mut out, to);
        }
        let mut dropped: Vec<_> = self.dropped_imports.iter().collect();
        dropped.sort();
        put_count(&mut out, dropped.len());
        for (from, specifier) in dropped {
            put(&mut out, from);
            put(&mut out, specifier);
        }
        let mut texts: Vec<_> = self.texts.iter().collect();
        texts.sort();
        put_count(&mut out, texts.len());
        for (path, text) in texts {
            put(&mut out, path);
            put(&mut out, text);
        }
        let mut assets: Vec<_> = self.assets.iter().collect();
        assets.sort();
        put_count(&mut out, assets.len());
        for (path, key) in assets {
            put(&mut out, path);
            put(&mut out, key);
        }
        put_count(&mut out, self.defines.len());
        for (name, value) in &self.defines {
            put(&mut out, name);
            put(&mut out, value);
        }
        put_count(&mut out, self.features.len());
        for feature in &self.features {
            put(&mut out, feature);
        }
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Snapshot> {
        let mut reader = Reader(bytes.strip_prefix(MAGIC)?);
        let cwd = reader.bytes()?;
        let has_tsconfig = reader.count()? != 0;
        let tsconfig = reader.bytes()?;
        let conditions = reader.list()?.into_iter().map(Vec::into_boxed_slice).collect();
        let entry_points = reader.list()?;
        let code = reader.list()?;
        let script_kinds = reader.kinds()?;
        let script_kinds_by_extension = reader.kinds()?;
        let already_read = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let resolved = (0..reader.count()?).map(|_| Some(((reader.bytes()?, reader.bytes()?), reader.bytes()?))).collect::<Option<_>>()?;
        let dropped_imports = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let texts = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let assets = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let defines = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let features = reader.list()?;
        Some(Snapshot {
            defines,
            features,
            cwd,
            tsconfig: has_tsconfig.then_some(tsconfig),
            conditions,
            entry_points,
            code,
            script_kinds,
            script_kinds_by_extension,
            already_read,
            resolved,
            dropped_imports,
            texts,
            assets,
        })
    }
}
