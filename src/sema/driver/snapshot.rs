use crate::host::{AlreadyRead, DeferredSources, from_native};
use bun_sema::resolve::ScriptKind;
use bun_sema::util::{FxHashMap, FxHashSet};

pub type Resolved = FxHashMap<(Vec<u8>, Vec<u8>), Vec<u8>>;

#[derive(Default)]
pub struct Snapshot {
    pub cwd: Vec<u8>,
    pub tsconfig: Option<Vec<u8>>,
    pub conditions: Vec<Box<[u8]>>,
    pub entry_points: Vec<Vec<u8>>,
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
    pub preserve_source_paths: bool,
    pub entry_functions: Vec<[Vec<u8>; 2]>,
    pub statements: Vec<(Vec<u8>, u32, bool)>,
    pub side_effect_free_files: Vec<Vec<u8>>,
    pub lifted_commonjs: Vec<Vec<u8>>,
    pub code_kinds: Vec<(Vec<u8>, bool)>,
    pub deferred_entry_points: usize,
    pub deferred_code: usize,
    pub deferred_imports: Vec<(Vec<u8>, Vec<u8>)>,
    pub deferred_paths: Vec<Vec<u8>>,
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
    pub fn take_deferred_sources(&mut self) -> Option<DeferredSources> {
        if self.deferred_entry_points == 0 && self.deferred_code == 0 {
            return None;
        }
        let paths = self.entry_points.split_off(self.entry_points.len().saturating_sub(self.deferred_entry_points));
        let code = self.code.split_off(self.code.len().saturating_sub(self.deferred_code));
        let is_deferred: FxHashSet<&[u8]> = paths.iter().chain(&code).map(Vec::as_slice).collect();
        let is_deferred_file: FxHashSet<Vec<u8>> = is_deferred.iter().map(|path| from_native(path)).collect();
        let (script_kinds, early_script_kinds) = std::mem::take(&mut self.script_kinds).into_iter().partition(|it| is_deferred.contains(&it.0[..]));
        let (code_kinds, early_code_kinds): (Vec<_>, Vec<_>) = std::mem::take(&mut self.code_kinds).into_iter().partition(|it| is_deferred.contains(&it.0[..]));
        let (already_read, early_already_read) = std::mem::take(&mut self.already_read).into_iter().partition(|it| is_deferred_file.contains(&it.0));
        (self.script_kinds, self.code_kinds, self.already_read) = (early_script_kinds, early_code_kinds, early_already_read);
        drop(is_deferred);
        Some(DeferredSources { paths, code, script_kinds, already_read, code_kinds: code_kinds.into_iter().collect(), ..Default::default() })
    }

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
        put_count(&mut out, usize::from(self.preserve_source_paths));
        put_count(&mut out, self.entry_functions.len());
        for files in &self.entry_functions {
            put(&mut out, &files[0]);
            put(&mut out, &files[1]);
        }
        let mut statements: Vec<_> = self.statements.iter().collect();
        statements.sort();
        put_count(&mut out, statements.len());
        for (path, start, verdict) in statements {
            put(&mut out, path);
            put_count(&mut out, (*start as usize) << 1 | usize::from(*verdict));
        }
        let mut side_effect_free_files: Vec<_> = self.side_effect_free_files.iter().collect();
        side_effect_free_files.sort();
        put_count(&mut out, side_effect_free_files.len());
        for path in side_effect_free_files {
            put(&mut out, path);
        }
        let mut lifted_commonjs: Vec<_> = self.lifted_commonjs.iter().collect();
        lifted_commonjs.sort();
        put_count(&mut out, lifted_commonjs.len());
        for path in lifted_commonjs {
            put(&mut out, path);
        }
        let mut code_kinds: Vec<_> = self.code_kinds.iter().collect();
        code_kinds.sort();
        put_count(&mut out, code_kinds.len());
        for (path, is_commonjs) in code_kinds {
            put(&mut out, path);
            put_count(&mut out, usize::from(*is_commonjs));
        }
        put_count(&mut out, self.deferred_entry_points);
        put_count(&mut out, self.deferred_code);
        put_count(&mut out, self.deferred_imports.len());
        for (from, specifier) in &self.deferred_imports {
            put(&mut out, from);
            put(&mut out, specifier);
        }
        put_count(&mut out, self.deferred_paths.len());
        for path in &self.deferred_paths {
            put(&mut out, path);
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
        let already_read = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?.into()))).collect::<Option<_>>()?;
        let resolved = (0..reader.count()?).map(|_| Some(((reader.bytes()?, reader.bytes()?), reader.bytes()?))).collect::<Option<_>>()?;
        let dropped_imports = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let texts = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let assets = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let defines = (0..reader.count()?).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let features = reader.list()?;
        let preserve_source_paths = reader.count().is_some_and(|it| it != 0);
        let entry_functions = (0..reader.count().unwrap_or(0)).map(|_| Some([reader.bytes()?, reader.bytes()?])).collect::<Option<_>>()?;
        let statements = (0..reader.count().unwrap_or(0)).map(|_| Some((reader.bytes()?, reader.count()?))).collect::<Option<Vec<_>>>()?;
        let statements = statements.into_iter().map(|(path, word)| (path, (word >> 1) as u32, word & 1 != 0)).collect();
        let side_effect_free_files = (0..reader.count().unwrap_or(0)).map(|_| reader.bytes()).collect::<Option<_>>()?;
        let lifted_commonjs = (0..reader.count().unwrap_or(0)).map(|_| reader.bytes()).collect::<Option<_>>()?;
        let code_kinds = (0..reader.count().unwrap_or(0)).map(|_| Some((reader.bytes()?, reader.count()? != 0))).collect::<Option<_>>()?;
        let deferred_entry_points = reader.count().unwrap_or(0);
        let deferred_code = reader.count().unwrap_or(0);
        let deferred_imports = (0..reader.count().unwrap_or(0)).map(|_| Some((reader.bytes()?, reader.bytes()?))).collect::<Option<_>>()?;
        let deferred_paths = (0..reader.count().unwrap_or(0)).map(|_| reader.bytes()).collect::<Option<_>>()?;
        Some(Snapshot {
            deferred_entry_points,
            deferred_code,
            deferred_imports,
            deferred_paths,
            entry_functions,
            defines,
            features,
            preserve_source_paths,
            statements,
            side_effect_free_files,
            lifted_commonjs,
            code_kinds,
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
