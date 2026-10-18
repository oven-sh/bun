use bstr::BStr;
use bun_sema::json::Json;
use bun_sema::resolve::TYPED_JAVASCRIPT_EXTENSIONS as TYPED_EXTENSIONS;
use bun_sys::Fd;

pub const SCOPE: &[u8] = b"@sound";
const FOLDER: &[u8] = b".sound";
const MANIFEST: &[u8] = b"sound.json";
const REPLACEMENTS: &[u8] = b"lay";
const NODE_MODULES_DIR: &[u8] = b"node_modules";
const PACKAGE_JSON: &[u8] = b"package.json";
pub const CONDITION: &[u8] = b"bun-aot";
const MAX_DEPTH: usize = 8;

pub type Files = Vec<(Box<[u8]>, Box<[u8]>, bool)>;
pub type Defines = [(Box<[u8]>, Box<[u8]>)];

pub fn typed_package(root: &[u8], defines: &Defines, directory: &[u8], name: &[u8]) -> (Files, Option<Box<str>>) {
    typed_package_under(root, Some(defines), directory, name)
}

pub fn typed_package_under_any_defines(root: &[u8], directory: &[u8], name: &[u8]) -> (Files, Option<Box<str>>) {
    typed_package_under(root, None, directory, name)
}

fn typed_package_under(root: &[u8], defines: Option<&Defines>, directory: &[u8], name: &[u8]) -> (Files, Option<Box<str>>) {
    let root = match root {
        [before @ .., last] if !before.is_empty() && is_separator(*last) => before,
        _ => root,
    };
    let name: Vec<u8> = name.iter().map(|&byte| if is_separator(byte) { b'/' } else { byte }).collect();
    let Some((home, is_shipped_with_the_package)) = typed_package_home(root, directory, &name) else {
        return (Vec::new(), None);
    };
    let shown: Vec<u8> = home.strip_prefix(root).map_or(&home[..], |inside| &inside[1..]).iter().map(|&byte| if is_separator(byte) { b'/' } else { byte }).collect();
    let shown = &shown[..];
    let found = match is_shipped_with_the_package {
        true => shipped_files(directory),
        false => files_of(root, defines, &home, directory, &name, 0),
    };
    let (files, said) = match found {
        Ok((files, version)) => (files, format!("\"{}\" {} is compiled from its typed version in {}", BStr::new(&name), BStr::new(&version), BStr::new(shown))),
        Err(why) => (Vec::new(), format!("the typed version of \"{}\" in {} is not used: {why}: the package is compiled untyped", BStr::new(&name), BStr::new(shown))),
    };
    let said: String = said.chars().map(|character| if character.is_control() { '?' } else { character }).collect();
    (files, Some(said.into_boxed_str()))
}

pub fn typed_version_providing(root: &[u8], directory: &[u8], name: &[u8], path: &[u8], text: &[u8]) -> Option<Vec<u8>> {
    let root = match root {
        [before @ .., last] if !before.is_empty() && is_separator(*last) => before,
        _ => root,
    };
    let name: Vec<u8> = name.iter().map(|&byte| if is_separator(byte) { b'/' } else { byte }).collect();
    let (home, _) = typed_package_home(root, directory, &name).filter(|(_, is_shipped_with_the_package)| !is_shipped_with_the_package)?;
    let inside = match path.strip_prefix(directory)? {
        [first, inside @ ..] if is_separator(*first) => inside,
        _ => return None,
    };
    let shown = home.strip_prefix(root).map_or(&home[..], |inside| &inside[1..]);
    (read(&join(&[&home, REPLACEMENTS, inside]))? == text).then(|| shown.to_vec())
}

fn is_separator(byte: u8) -> bool {
    byte == b'/' || cfg!(windows) && byte == b'\\'
}

pub(crate) fn join(parts: &[&[u8]]) -> Vec<u8> {
    parts.join(&b'/')
}

pub(crate) fn ancestors(path: &[u8]) -> impl Iterator<Item = &[u8]> {
    std::iter::successors(Some(path), |path| {
        let at = path.iter().rposition(|&byte| is_separator(byte))?;
        (at > 0).then(|| &path[..at])
    })
}

fn read(path: &[u8]) -> Option<Vec<u8>> {
    let text = bun_sys::File::read_from(Fd::cwd(), path).ok();
    crate::fs_queries::record_query(crate::fs_queries::Kind::NativeText, path, |hash| crate::fs_queries::of_text(hash, text.as_deref()));
    text
}

pub(crate) fn read_json(path: &[u8]) -> Option<Json> {
    parse(&read(path)?)
}

fn companion_package_name(name: &[u8]) -> Vec<u8> {
    let flat = match name.strip_prefix(b"@") {
        Some(scoped) => bun_core::strings::split(scoped, b"/").collect::<Vec<_>>().join(&b"__"[..]),
        None => name.to_vec(),
    };
    join(&[SCOPE, &flat])
}

fn package_javascript_files(package: &Json) -> Vec<Vec<u8>> {
    fn add(value: &Json, depth: usize, found: &mut Vec<Vec<u8>>) {
        const NAMES: [(&[u8], &[u8]); 4] = [(b".d.ts", b".js"), (b".d.mts", b".mjs"), (b".js", b".js"), (b".mjs", b".mjs")];
        if let Some(path) = value.as_str() {
            let path = path.strip_prefix(b"./").unwrap_or(path);
            let javascript = NAMES.iter().find_map(|(from, to)| Some([path.strip_suffix(*from)?, *to].concat()));
            found.extend(javascript.filter(|javascript| is_relative_inner_path(javascript) && !found.contains(javascript)));
        } else if depth < MAX_DEPTH {
            value.as_object().unwrap_or_default().iter().for_each(|(_, inner)| add(inner, depth + 1, found));
            value.as_array().unwrap_or_default().iter().for_each(|inner| add(inner, depth + 1, found));
        }
    }
    let mut found = Vec::new();
    for field in [&b"types"[..], b"typings", b"exports", b"module", b"main"] {
        package.get(field).into_iter().for_each(|value| add(value, 0, &mut found));
    }
    if found.is_empty() {
        found.push(b"index.js".to_vec());
    }
    found
}

fn javascript_files_with_the_condition(directory: &[u8], package: &Json) -> Vec<Vec<u8>> {
    fn add(value: &Json, folder: &[u8], depth: usize, found: &mut Vec<Vec<u8>>) {
        for (key, inner) in value.as_object().unwrap_or_default() {
            match inner.as_str().filter(|_| &key[..] == CONDITION) {
                Some(typed) => {
                    let javascript = javascript_path_beside(typed.strip_prefix(b"./").unwrap_or(typed)).map(|javascript| [folder, &javascript[..]].concat());
                    found.extend(javascript.filter(|javascript| is_relative_inner_path(javascript) && !found.contains(javascript)));
                }
                None if depth < MAX_DEPTH => add(inner, folder, depth + 1, found),
                None => {}
            }
        }
    }
    let mut found = Vec::new();
    package.get(b"exports").into_iter().for_each(|exports| add(exports, b"", 0, &mut found));
    if found.is_empty() {
        let mut folders: Vec<Vec<u8>> = Vec::new();
        for javascript in package_javascript_files(package) {
            for folder in ancestors(&javascript).skip(1) {
                if !folders.iter().any(|known| &known[..] == folder) {
                    folders.push(folder.to_vec());
                }
            }
        }
        for folder in folders {
            let nested = read_json(&join(&[directory, &folder, PACKAGE_JSON]));
            nested.as_ref().and_then(|nested| nested.get(b"exports")).into_iter().for_each(|exports| add(exports, &[&folder[..], b"/"].concat(), 0, &mut found));
        }
    }
    found
}

fn package_typed_home(directory: &[u8]) -> Option<Vec<u8>> {
    let package = read_json(&join(&[directory, PACKAGE_JSON]))?;
    let marked = javascript_files_with_the_condition(directory, &package).into_iter().next()?;
    Some(match bun_core::strings::last_index_of_char(&marked[..], b'/') {
        Some(slash) => join(&[directory, &marked[..slash]]),
        None => directory.to_vec(),
    })
}

fn shipped_files(directory: &[u8]) -> Result<(Files, Vec<u8>), String> {
    let package = read_json(&join(&[directory, PACKAGE_JSON])).ok_or("the installed package.json is not JSON")?;
    let with_the_condition = javascript_files_with_the_condition(directory, &package);
    let mut waiting = with_the_condition.clone();
    let mut seen = waiting.clone();
    let mut files = Vec::new();
    while let Some(javascript) = waiting.pop() {
        let folder = bun_core::strings::last_index_of_char(&javascript[..], b'/').map_or(&b""[..], |slash| &javascript[..slash + 1]);
        let Some(typed) = typed_path_beside(&javascript) else { continue };
        if !with_the_condition.contains(&javascript) && !crate::fs_queries::exists(&join(&[directory, &typed])) {
            continue;
        }
        let Some(text) = read(&join(&[directory, &typed])) else {
            return Err(format!("it has no {}", BStr::new(&typed)));
        };
        let erased = crate::sound_files::erase(&typed, &text).map_err(|why| format!("the types of {} cannot be erased: {why}", BStr::new(&typed)))?;
        if read(&join(&[directory, &javascript])).is_none_or(|installed| installed != erased.javascript) {
            return Err(format!("{} without its types is not {} (was the package patched?)", BStr::new(&typed), BStr::new(&javascript)));
        }
        for specifier in &erased.relative_imports {
            let mut parts: Vec<&[u8]> = bun_core::strings::split(folder, b"/").filter(|part| !part.is_empty()).collect();
            let mut leaves = false;
            for part in bun_core::strings::split(specifier, b"/") {
                match part {
                    b"." => {}
                    b".." => leaves |= parts.pop().is_none(),
                    _ => parts.push(part),
                }
            }
            let imported = parts.join(&b'/');
            let candidates = [imported.clone(), [&imported[..], b".js"].concat(), [&imported[..], b".mjs"].concat(), [&imported[..], b"/index.js"].concat()];
            let imported = candidates.into_iter().find(|candidate| typed_path_beside(candidate).is_some() && crate::fs_queries::exists(&join(&[directory, candidate])));
            if let Some(imported) = imported.filter(|imported| !leaves && is_relative_inner_path(imported) && !seen.contains(imported)) {
                seen.push(imported.clone());
                waiting.push(imported);
            }
        }
        let specifier = BStr::new(bun_core::strings::split(&typed, b"/").last().unwrap_or(&typed));
        let entry_point = match erased.has_default_export {
            true => format!("export * from \"./{specifier}\";\nexport {{ default }} from \"./{specifier}\";\n"),
            false => format!("export * from \"./{specifier}\";\n"),
        };
        let laid = match erased.has_untyped_exports {
            true => vec![(&javascript[..], entry_point.into_bytes(), false), (&typed[..], text, false)],
            false => vec![(&javascript[..], text, true)],
        };
        for (path, text, is_typescript) in laid {
            let mut at = join(&[directory, path]);
            if cfg!(windows) {
                at.iter_mut().filter(|byte| **byte == b'\\').for_each(|byte| *byte = b'/');
            }
            files.push((at.into_boxed_slice(), text.into_boxed_slice(), is_typescript));
        }
    }
    Ok((files, package.get(b"version").and_then(Json::as_str).unwrap_or_default().to_vec()))
}

pub fn typed_path_beside(javascript: &[u8]) -> Option<Vec<u8>> {
    TYPED_EXTENSIONS.iter().find_map(|(from, to)| Some([javascript.strip_suffix(*from)?, *to].concat()))
}

pub fn javascript_path_beside(typed: &[u8]) -> Option<Vec<u8>> {
    TYPED_EXTENSIONS.iter().find_map(|(to, from)| Some([typed.strip_suffix(*from)?, *to].concat()))
}

pub fn declarations_path_beside(javascript: &[u8]) -> Option<Vec<u8>> {
    const EXTENSIONS: [(&[u8], &[u8]); 3] = [(b".js", b".d.ts"), (b".mjs", b".d.mts"), (b".cjs", b".d.cts")];
    EXTENSIONS.iter().find_map(|(from, to)| Some([javascript.strip_suffix(*from)?, *to].concat()))
}

fn typed_package_home(root: &[u8], directory: &[u8], name: &[u8]) -> Option<(Vec<u8>, bool)> {
    let has_manifest = |home: &Vec<u8>| crate::fs_queries::exists(&join(&[home, MANIFEST]));
    let own = join(&[root, FOLDER, name]);
    if has_manifest(&own) {
        return Some((own, false));
    }
    if let Some(shipped) = package_typed_home(directory) {
        return Some((shipped, true));
    }
    let companion = companion_package_name(name);
    let home = ancestors(root).map(|at| join(&[at, NODE_MODULES_DIR, &companion])).find(has_manifest)?;
    let project = ancestors(root).find_map(|at| read(&join(&[at, PACKAGE_JSON])))?;
    let project = parse(&project)?;
    let lists_it = |field: &[u8]| project.get(field).is_some_and(|listed| listed.get(&companion).is_some());
    (lists_it(b"dependencies") || lists_it(b"devDependencies")).then_some((home, false))
}

fn is_relative_inner_path(path: &[u8]) -> bool {
    path != PACKAGE_JSON && bun_core::strings::index_of_any(path, b"\\\0").is_none() && bun_core::strings::split(path, b"/").all(|part| !matches!(part, b"" | b"." | b".."))
}

fn is_package_name(name: &[u8]) -> bool {
    is_relative_inner_path(name) && bun_core::strings::split(name, b"/").count() == if name.starts_with(b"@") { 2 } else { 1 }
}

fn entries<'m>(manifest: &'m Json, field: &str) -> Result<Vec<(&'m [u8], &'m [u8])>, String> {
    let Some(listed) = manifest.get(field.as_bytes()) else {
        return Ok(Vec::new());
    };
    let is_refused = || format!("\"{field}\" of its sound.json is not an object of strings");
    let mut found = Vec::new();
    for (path, value) in listed.as_object().ok_or_else(is_refused)? {
        found.push((&path[..], value.as_str().ok_or_else(is_refused)?));
    }
    Ok(found)
}

fn verify_typed_against(directory: &[u8], path: &[u8], wanted: &[u8]) -> Result<(), String> {
    if !is_relative_inner_path(path) {
        return Err(format!("\"{}\" in its sound.json is no path inside the package", BStr::new(path)));
    }
    let Some(installed) = read(&join(&[directory, path])) else {
        return Err(format!("{} is not installed", BStr::new(path)));
    };
    match hex(&sha256(&installed)) == wanted {
        true => Ok(()),
        false => Err(format!("the installed {} differs from the published file that this typed version was made from (was the package patched?)", BStr::new(path))),
    }
}

fn files_of(root: &[u8], defines: Option<&Defines>, home: &[u8], directory: &[u8], name: &[u8], depth: usize) -> Result<(Files, Vec<u8>), String> {
    let manifest = read_json(&join(&[home, MANIFEST])).ok_or("its sound.json is not JSON")?;
    let ships_typescript_with_js_extension = manifest.get(b"sound") == Some(&Json::Number(2.0));
    if !ships_typescript_with_js_extension && manifest.get(b"sound") != Some(&Json::Number(1.0)) {
        return Err("its sound.json is of a format that this Bun does not know".into());
    }
    let installed = read_json(&join(&[directory, PACKAGE_JSON])).ok_or("the installed package.json is not JSON")?;
    let text_of = |json: &Json, field: &[u8]| json.get(field).and_then(Json::as_str).unwrap_or_default().to_vec();
    if text_of(&manifest, b"name") != name || text_of(&installed, b"name") != name {
        return Err(format!("it is for \"{}\", and \"{}\" is installed", BStr::new(&text_of(&manifest, b"name")), BStr::new(&text_of(&installed, b"name"))));
    }
    if text_of(&manifest, b"version") != text_of(&installed, b"version") {
        let found = text_of(&installed, b"version");
        return Err(format!("it is for version {}, and {} is installed (install the typed version for {}, or remove this one)", BStr::new(&text_of(&manifest, b"version")), BStr::new(&found), BStr::new(&found)));
    }
    for (key, wanted) in entries(&manifest, "when")? {
        let Some(defines) = defines else { continue };
        let defined = defines.iter().find(|define| &*define.0 == key).and_then(|define| parse(&define.1));
        if defined != Some(Json::String(wanted.to_vec())) {
            return Err(format!("it is for a build that defines {} as \"{}\" (pass --define '{}=\"{}\"')", BStr::new(key), BStr::new(wanted), BStr::new(key), BStr::new(wanted)));
        }
    }
    for (path, wanted) in entries(&manifest, "basis")? {
        verify_typed_against(directory, path, wanted)?;
    }
    let mut files = Vec::new();
    for (path, wanted) in entries(&manifest, "lay")? {
        let mut at = join(&[directory, path]);
        match wanted {
            b"new" if !is_relative_inner_path(path) => return Err(format!("\"{}\" in its sound.json is no path inside the package", BStr::new(path))),
            b"new" if crate::fs_queries::exists(&at) => return Err(format!("{} is installed, and it was not when the package was typed", BStr::new(path))),
            b"new" => {}
            _ => verify_typed_against(directory, path, wanted)?,
        }
        let Some(text) = read(&join(&[home, REPLACEMENTS, path])) else {
            return Err(format!("it has no lay/{}", BStr::new(path)));
        };
        if cfg!(windows) {
            at.iter_mut().filter(|byte| **byte == b'\\').for_each(|byte| *byte = b'/');
        }
        let is_typescript = ships_typescript_with_js_extension && [&b".js"[..], b".cjs", b".mjs"].iter().any(|extension| path.ends_with(extension));
        files.push((at.into_boxed_slice(), text.into_boxed_slice(), is_typescript));
    }
    if files.is_empty() {
        return Err("its sound.json lays nothing".into());
    }
    for needed in manifest.get(b"needs").and_then(Json::as_array).unwrap_or_default() {
        let needed = needed.as_str().filter(|needed| is_package_name(needed)).ok_or("\"needs\" of its sound.json is not a list of packages' names")?;
        let there = ancestors(directory).map(|at| join(&[at, NODE_MODULES_DIR, needed])).find(|there| crate::fs_queries::exists(&join(&[there, PACKAGE_JSON])));
        let fits = |there: Vec<u8>| {
            typed_package_home(root, &there, needed).is_some_and(|(home, is_shipped_with_the_package)| match is_shipped_with_the_package {
                true => shipped_files(&there).is_ok(),
                false => files_of(root, defines, &home, &there, needed, depth + 1).is_ok(),
            })
        };
        if depth == MAX_DEPTH || !there.is_some_and(fits) {
            return Err(format!("it needs the typed version of \"{}\", which is not used", BStr::new(needed)));
        }
    }
    Ok((files, text_of(&manifest, b"version")))
}

pub(crate) fn hex(bytes: &[u8]) -> Vec<u8> {
    bytes.iter().flat_map(|byte| [b"0123456789abcdef"[(byte >> 4) as usize], b"0123456789abcdef"[(byte & 15) as usize]]).collect()
}

pub(crate) fn sha256(bytes: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut state: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut tail = bytes[bytes.len() / 64 * 64..].to_vec();
    tail.push(0x80);
    while tail.len() % 64 != 56 {
        tail.push(0);
    }
    tail.extend_from_slice(&(bytes.len() as u64 * 8).to_be_bytes());
    for block in bytes.as_chunks::<64>().0.iter().chain(tail.as_chunks::<64>().0) {
        let mut w = [0u32; 64];
        for (word, four) in w.iter_mut().zip(block.as_chunks::<4>().0) {
            *word = u32::from_be_bytes([four[0], four[1], four[2], four[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let t1 = h.wrapping_add(s1).wrapping_add((e & f) ^ (!e & g)).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let t2 = s0.wrapping_add((a & b) ^ (a & c) ^ (b & c));
            (h, g, f, e, d, c, b, a) = (g, f, e, d.wrapping_add(t1), c, b, a, t1.wrapping_add(t2));
        }
        for (word, more) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *word = word.wrapping_add(more);
        }
    }
    let mut digest = [0u8; 32];
    for (four, word) in digest.as_chunks_mut::<4>().0.iter_mut().zip(state) {
        four.copy_from_slice(&word.to_be_bytes());
    }
    digest
}

pub(crate) fn parse(text: &[u8]) -> Option<Json> {
    let text = text.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(text);
    let mut at = 0;
    let value = value(text, &mut at, 0)?;
    skip(text, &mut at);
    (at == text.len()).then_some(value)
}

fn skip(text: &[u8], at: &mut usize) {
    while matches!(text.get(*at), Some(b' ' | b'\t' | b'\n' | b'\r')) {
        *at += 1;
    }
}

fn takes(text: &[u8], at: &mut usize, word: &[u8]) -> bool {
    skip(text, at);
    let is_there = text[*at..].starts_with(word);
    if is_there {
        *at += word.len();
    }
    is_there
}

fn value(text: &[u8], at: &mut usize, depth: usize) -> Option<Json> {
    skip(text, at);
    match *text.get(*at)? {
        _ if depth > 64 => None,
        b'{' => {
            *at += 1;
            let mut entries = Vec::new();
            if takes(text, at, b"}") {
                return Some(Json::Object(entries));
            }
            loop {
                skip(text, at);
                let key = string(text, at)?;
                if !takes(text, at, b":") {
                    return None;
                }
                entries.push((key, value(text, at, depth + 1)?));
                if takes(text, at, b"}") {
                    return Some(Json::Object(entries));
                }
                if !takes(text, at, b",") {
                    return None;
                }
            }
        }
        b'[' => {
            *at += 1;
            let mut elements = Vec::new();
            if takes(text, at, b"]") {
                return Some(Json::Array(elements));
            }
            loop {
                elements.push(value(text, at, depth + 1)?);
                if takes(text, at, b"]") {
                    return Some(Json::Array(elements));
                }
                if !takes(text, at, b",") {
                    return None;
                }
            }
        }
        b'"' => string(text, at).map(Json::String),
        b't' => takes(text, at, b"true").then_some(Json::Bool(true)),
        b'f' => takes(text, at, b"false").then_some(Json::Bool(false)),
        b'n' => takes(text, at, b"null").then_some(Json::Null),
        _ => {
            let length = text[*at..].iter().take_while(|byte| matches!(byte, b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')).count();
            let number = std::str::from_utf8(&text[*at..*at + length]).ok()?.parse().ok()?;
            *at += length;
            Some(Json::Number(number))
        }
    }
}

fn four_hex_digits(text: &[u8], at: &mut usize) -> Option<u32> {
    let digits = std::str::from_utf8(text.get(*at..*at + 4)?).ok()?;
    *at += 4;
    u32::from_str_radix(digits, 16).ok()
}

fn string(text: &[u8], at: &mut usize) -> Option<Vec<u8>> {
    if text.get(*at) != Some(&b'"') {
        return None;
    }
    *at += 1;
    let mut out = Vec::new();
    loop {
        let byte = *text.get(*at)?;
        *at += 1;
        match byte {
            b'"' => return Some(out),
            b'\\' => {
                let escaped = *text.get(*at)?;
                *at += 1;
                match escaped {
                    b'"' | b'\\' | b'/' => out.push(escaped),
                    b'b' => out.push(8),
                    b'f' => out.push(12),
                    b'n' => out.push(b'\n'),
                    b'r' => out.push(b'\r'),
                    b't' => out.push(b'\t'),
                    b'u' => {
                        let mut unit = four_hex_digits(text, at)?;
                        if (0xD800..0xDC00).contains(&unit) && text[*at..].starts_with(b"\\u") {
                            let mut behind = *at + 2;
                            let low = four_hex_digits(text, &mut behind)?;
                            if (0xDC00..0xE000).contains(&low) {
                                unit = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00);
                                *at = behind;
                            }
                        }
                        let character = char::from_u32(unit).unwrap_or(char::REPLACEMENT_CHARACTER);
                        out.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
                    }
                    _ => return None,
                }
            }
            _ if byte < 0x20 => return None,
            _ => out.push(byte),
        }
    }
}
