use std::collections::HashMap;
use std::sync::OnceLock;

pub type Entries = &'static [(u32, u32)];

struct File {
    len: u32,
    hash: u32,
    entries: Vec<(u32, u32)>,
}

struct Table {
    root: Vec<u8>,
    files: HashMap<Vec<u8>, File>,
    needs_every_source: bool,
}

static TAGS: OnceLock<Option<Table>> = OnceLock::new();

pub fn tags_for(path: &[u8], contents: &[u8]) -> Option<Entries> {
    let table: &'static Table = TAGS
        .get_or_init(|| load_table("BUN_SOUND_TYPES_TAGS", b"TSTG"))
        .as_ref()?;
    let file = path
        .strip_prefix(table.root.as_slice())
        .and_then(|relative| table.files.get(relative));
    let same = file.is_some_and(|f| f.len as usize == contents.len() && f.hash == fnv1a32(contents));
    let what = if same { "same" } else if file.is_some() { "differs" } else { "unknown" };
    note_lookup(table, path, contents, what);
    note_source(path, what);
    if !same {
        return None;
    }
    Some(file?.entries.as_slice())
}

static SOURCES: std::sync::Mutex<Option<HashMap<Vec<u8>, &'static str>>> = std::sync::Mutex::new(None);

fn note_source(path: &[u8], what: &'static str) {
    let mut sources = SOURCES.lock().unwrap();
    let sources = sources.get_or_insert_with(Default::default);
    if !sources.contains_key(path) {
        sources.insert(path.to_vec(), what);
    }
}

fn is_code_of_the_program(path: &[u8]) -> bool {
    const CODE: [&[u8]; 8] = [b".ts", b".tsx", b".mts", b".cts", b".js", b".jsx", b".mjs", b".cjs"];
    let is_file = path.first() == Some(&b'/') || path.get(1) == Some(&b':');
    let is_in_a_package = path.windows(14).any(|part| part == b"/node_modules/" || part == b"\\node_modules\\");
    is_file && !is_in_a_package && CODE.iter().any(|extension| path.ends_with(extension))
}

pub struct TableCoverage {
    pub tagged: usize,
    pub differing: usize,
    pub unknown: usize,
    pub refused: Vec<(Vec<u8>, &'static str)>,
}

pub fn take_table_coverage() -> Option<TableCoverage> {
    let table = TAGS.get()?.as_ref()?;
    let sources = SOURCES.lock().unwrap().take().unwrap_or_default();
    let tagged = sources.values().filter(|what| **what == "same").count();
    let mut not_seen: Vec<(Vec<u8>, &'static str)> = sources
        .into_iter()
        .filter(|(path, what)| *what == "differs" || (*what == "unknown" && is_code_of_the_program(path)))
        .collect();
    not_seen.sort();
    let differing = not_seen.iter().filter(|(_, what)| *what == "differs").count();
    let unknown = not_seen.len() - differing;
    if !table.needs_every_source {
        not_seen.retain(|(_, what)| *what == "differs");
    }
    Some(TableCoverage { tagged, differing, unknown, refused: not_seen })
}

fn note_lookup(table: &Table, path: &[u8], contents: &[u8], what: &str) {
    use std::io::Write;
    static SEEN: std::sync::Mutex<Option<std::collections::HashSet<Vec<u8>>>> = std::sync::Mutex::new(None);
    let Some(log) = std::env::var_os("BUN_SOUND_TYPES_TAGS_LOG") else {
        return;
    };
    let mut seen = SEEN.lock().unwrap();
    if !seen.get_or_insert_with(Default::default).insert(path.to_vec()) {
        return;
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log) {
        let _ = writeln!(file, "{}\t{}\t{}", what, contents.len(), String::from_utf8_lossy(path));
    }
    if what != "differs" {
        return;
    }
    let (Some(directory), Some(relative)) = (
        std::env::var_os("BUN_SOUND_TYPES_TAGS_DUMP"),
        path.strip_prefix(table.root.as_slice()),
    ) else {
        return;
    };
    let to = std::path::Path::new(&directory).join(String::from_utf8_lossy(relative).as_ref());
    if let Some(parent) = to.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(to, contents);
}

fn load_table(variable: &str, magic: &[u8; 4]) -> Option<Table> {
    let path = std::env::var_os(variable)?;
    let mut root = std::env::var_os("BUN_SOUND_TYPES_ORACLE_ROOT")?
        .into_encoded_bytes();
    if root.last() != Some(&b'/') {
        root.push(b'/');
    }
    let bytes = std::fs::read(path).ok()?;
    let mut at = 0usize;
    let word = |at: &mut usize| -> Option<u32> {
        let w = u32::from_le_bytes(bytes.get(*at..*at + 4)?.try_into().ok()?);
        *at += 4;
        Some(w)
    };
    if bytes.get(0..4)? != magic {
        return None;
    }
    at += 4;
    if word(&mut at)? != 1 {
        return None;
    }
    let count = word(&mut at)?;
    let mut files = HashMap::new();
    for _ in 0..count {
        let path_len = word(&mut at)? as usize;
        let name = bytes.get(at..at + path_len)?.to_vec();
        at += (path_len + 3) & !3;
        let len = word(&mut at)?;
        let hash = word(&mut at)?;
        let entry_count = word(&mut at)? as usize;
        let mut entries = Vec::with_capacity(entry_count);
        for _ in 0..entry_count {
            let anchor = word(&mut at)?;
            let m = word(&mut at)?;
            entries.push((anchor, m));
        }
        files.insert(name, File { len, hash, entries });
    }
    let needs_every_source = !word(&mut at).is_some_and(|flags| flags & 1 != 0);
    Some(Table {
        root,
        files,
        needs_every_source,
    })
}

fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut h = 0x811c_9dc5u32;
    for &b in bytes {
        h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
    h
}
