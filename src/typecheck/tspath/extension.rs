// internal/tspath/extension.go
use crate::stringutil::util::strings;
use crate::tspath::path::{file_extension_is, get_any_extension_from_path, get_base_file_name};

pub const EXTENSION_TS: &[u8] = b".ts";
pub const EXTENSION_TSX: &[u8] = b".tsx";
pub const EXTENSION_DTS: &[u8] = b".d.ts";
pub const EXTENSION_JS: &[u8] = b".js";
pub const EXTENSION_JSX: &[u8] = b".jsx";
pub const EXTENSION_JSON: &[u8] = b".json";
pub const EXTENSION_TS_BUILD_INFO: &[u8] = b".tsbuildinfo";
pub const EXTENSION_MJS: &[u8] = b".mjs";
pub const EXTENSION_MTS: &[u8] = b".mts";
pub const EXTENSION_DMTS: &[u8] = b".d.mts";
pub const EXTENSION_CJS: &[u8] = b".cjs";
pub const EXTENSION_CTS: &[u8] = b".cts";
pub const EXTENSION_DCTS: &[u8] = b".d.cts";

pub const SUPPORTED_DECLARATION_EXTENSIONS: &[&[u8]] =
    &[EXTENSION_DTS, EXTENSION_DCTS, EXTENSION_DMTS];
pub const SUPPORTED_TS_IMPLEMENTATION_EXTENSIONS: &[&[u8]] =
    &[EXTENSION_TS, EXTENSION_TSX, EXTENSION_MTS, EXTENSION_CTS];
const SUPPORTED_TS_EXTENSIONS_FOR_EXTRACT_EXTENSION: &[&[u8]] = &[
    EXTENSION_DTS,
    EXTENSION_DCTS,
    EXTENSION_DMTS,
    EXTENSION_TS,
    EXTENSION_TSX,
    EXTENSION_MTS,
    EXTENSION_CTS,
];
pub const ALL_SUPPORTED_EXTENSIONS: &[&[&[u8]]] = &[
    &[
        EXTENSION_TS,
        EXTENSION_TSX,
        EXTENSION_DTS,
        EXTENSION_JS,
        EXTENSION_JSX,
    ],
    &[EXTENSION_CTS, EXTENSION_DCTS, EXTENSION_CJS],
    &[EXTENSION_MTS, EXTENSION_DMTS, EXTENSION_MJS],
];
pub const SUPPORTED_TS_EXTENSIONS: &[&[&[u8]]] = &[
    &[EXTENSION_TS, EXTENSION_TSX, EXTENSION_DTS],
    &[EXTENSION_CTS, EXTENSION_DCTS],
    &[EXTENSION_MTS, EXTENSION_DMTS],
];
pub const SUPPORTED_TS_EXTENSIONS_FLAT: &[&[u8]] = &[
    EXTENSION_TS,
    EXTENSION_TSX,
    EXTENSION_DTS,
    EXTENSION_CTS,
    EXTENSION_DCTS,
    EXTENSION_MTS,
    EXTENSION_DMTS,
];
pub const SUPPORTED_JS_EXTENSIONS: &[&[&[u8]]] = &[
    &[EXTENSION_JS, EXTENSION_JSX],
    &[EXTENSION_MJS],
    &[EXTENSION_CJS],
];
pub const SUPPORTED_JS_EXTENSIONS_FLAT: &[&[u8]] =
    &[EXTENSION_JS, EXTENSION_JSX, EXTENSION_MJS, EXTENSION_CJS];
pub const ALL_SUPPORTED_EXTENSIONS_WITH_JSON: &[&[&[u8]]] = &[
    &[
        EXTENSION_TS,
        EXTENSION_TSX,
        EXTENSION_DTS,
        EXTENSION_JS,
        EXTENSION_JSX,
    ],
    &[EXTENSION_CTS, EXTENSION_DCTS, EXTENSION_CJS],
    &[EXTENSION_MTS, EXTENSION_DMTS, EXTENSION_MJS],
    &[EXTENSION_JSON],
];
pub const SUPPORTED_TS_EXTENSIONS_WITH_JSON: &[&[&[u8]]] = &[
    &[EXTENSION_TS, EXTENSION_TSX, EXTENSION_DTS],
    &[EXTENSION_CTS, EXTENSION_DCTS],
    &[EXTENSION_MTS, EXTENSION_DMTS],
    &[EXTENSION_JSON],
];
pub const SUPPORTED_TS_EXTENSIONS_WITH_JSON_FLAT: &[&[u8]] = &[
    EXTENSION_TS,
    EXTENSION_TSX,
    EXTENSION_DTS,
    EXTENSION_CTS,
    EXTENSION_DCTS,
    EXTENSION_MTS,
    EXTENSION_DMTS,
    EXTENSION_JSON,
];
pub const EXTENSIONS_NOT_SUPPORTING_EXTENSIONLESS_RESOLUTION: &[&[u8]] = &[
    EXTENSION_MTS,
    EXTENSION_DMTS,
    EXTENSION_MJS,
    EXTENSION_CTS,
    EXTENSION_DCTS,
    EXTENSION_CJS,
];

pub fn extension_is_ts(ext: &[u8]) -> bool {
    ext == EXTENSION_TS
        || ext == EXTENSION_TSX
        || ext == EXTENSION_DTS
        || ext == EXTENSION_MTS
        || ext == EXTENSION_DMTS
        || ext == EXTENSION_CTS
        || ext == EXTENSION_DCTS
        || ext.len() >= 7 && ext.starts_with(b".d.") && ext.ends_with(b".ts")
}

const EXTENSIONS_TO_REMOVE: &[&[u8]] = &[
    EXTENSION_DTS,
    EXTENSION_DMTS,
    EXTENSION_DCTS,
    EXTENSION_MJS,
    EXTENSION_MTS,
    EXTENSION_CJS,
    EXTENSION_CTS,
    EXTENSION_TS,
    EXTENSION_JS,
    EXTENSION_TSX,
    EXTENSION_JSX,
    EXTENSION_JSON,
];

pub fn remove_file_extension(path: &[u8]) -> &[u8] {
    // Remove any known extension even if it has more than one dot
    for ext in EXTENSIONS_TO_REMOVE {
        if let Some(without_extension) = path.strip_suffix(*ext) {
            return without_extension;
        }
    }

    path
}

pub fn remove_any_file_extension(path: &[u8]) -> &[u8] {
    let without_extension = remove_file_extension(path);
    if without_extension != path {
        return without_extension;
    }
    let extension = get_any_extension_from_path(path, &[], false);
    if !extension.is_empty() {
        return remove_extension(path, &extension);
    }
    path
}

pub fn try_get_extension_from_path(p: &[u8]) -> &'static [u8] {
    for ext in EXTENSIONS_TO_REMOVE {
        if file_extension_is(p, ext) {
            return ext;
        }
    }
    b""
}

// The path without its last `extension.len()` bytes: the empty string when the extension is longer than the path, where upstream panics.
pub fn remove_extension<'a>(path: &'a [u8], extension: &[u8]) -> &'a [u8] {
    path.get(..path.len().saturating_sub(extension.len()))
        .unwrap_or(&[])
}

pub fn file_extension_is_one_of(path: &[u8], extensions: &[&[u8]]) -> bool {
    for ext in extensions {
        if file_extension_is(path, ext) {
            return true;
        }
    }
    false
}

pub fn try_extract_ts_extension(file_name: &[u8]) -> &'static [u8] {
    for ext in SUPPORTED_TS_EXTENSIONS_FOR_EXTRACT_EXTENSION {
        if file_extension_is(file_name, ext) {
            return ext;
        }
    }
    b""
}

pub fn has_ts_file_extension(path: &[u8]) -> bool {
    file_extension_is_one_of(path, SUPPORTED_TS_EXTENSIONS_FLAT)
}

pub fn has_implementation_ts_file_extension(path: &[u8]) -> bool {
    file_extension_is_one_of(path, SUPPORTED_TS_IMPLEMENTATION_EXTENSIONS)
        && !is_declaration_file_name(path)
}

pub fn has_js_file_extension(path: &[u8]) -> bool {
    file_extension_is_one_of(path, SUPPORTED_JS_EXTENSIONS_FLAT)
}

pub fn has_json_file_extension(path: &[u8]) -> bool {
    file_extension_is(path, EXTENSION_JSON)
}

pub fn is_declaration_file_name(file_name: &[u8]) -> bool {
    !get_declaration_file_extension(file_name).is_empty()
}

pub fn extension_is_one_of(ext: &[u8], extensions: &[&[u8]]) -> bool {
    extensions.contains(&ext)
}

pub fn get_declaration_file_extension(file_name: &[u8]) -> Vec<u8> {
    let base = get_base_file_name(file_name);
    for ext in SUPPORTED_DECLARATION_EXTENSIONS {
        if base.ends_with(ext) {
            return ext.to_vec();
        }
    }
    if base.ends_with(EXTENSION_TS) {
        let index = strings::index(&base, b".d.");
        if index >= 0 {
            return strings::slice_from(&base, index).to_vec();
        }
    }
    Vec::new()
}

pub fn get_declaration_emit_extension_for_path(path: &[u8]) -> Vec<u8> {
    if file_extension_is_one_of(path, &[EXTENSION_MJS, EXTENSION_MTS]) {
        return EXTENSION_DMTS.to_vec();
    }
    if file_extension_is_one_of(path, &[EXTENSION_CJS, EXTENSION_CTS]) {
        return EXTENSION_DCTS.to_vec();
    }
    if file_extension_is_one_of(
        path,
        &[EXTENSION_TS, EXTENSION_TSX, EXTENSION_JS, EXTENSION_JSX],
    ) {
        return EXTENSION_DTS.to_vec();
    }
    let ext = get_any_extension_from_path(path, &[], false);
    if !ext.is_empty() {
        let mut result = b".d".to_vec();
        result.extend_from_slice(&ext);
        result.extend_from_slice(b".ts");
        return result;
    }
    EXTENSION_DTS.to_vec()
}

// ChangeAnyExtension changes the extension of a path to the provided extension if it has one of the provided extensions.
pub fn change_any_extension(
    path: &[u8],
    ext: &[u8],
    extensions: &[&[u8]],
    ignore_case: bool,
) -> Vec<u8> {
    let pathext = get_any_extension_from_path(path, extensions, ignore_case);
    if !pathext.is_empty() {
        let mut result = remove_extension(path, &pathext).to_vec();
        if ext.is_empty() {
            return result;
        }
        if !ext.starts_with(b".") {
            result.push(b'.');
        }
        result.extend_from_slice(ext);
        return result;
    }
    path.to_vec()
}

pub fn change_extension(path: &[u8], new_extension: &[u8]) -> Vec<u8> {
    change_any_extension(path, new_extension, EXTENSIONS_TO_REMOVE, false)
}

// Like `changeAnyExtension`, but declaration file extensions are recognized and replaced starting from the `.d`.
pub fn change_full_extension(path: &[u8], new_extension: &[u8]) -> Vec<u8> {
    let declaration_extension = get_declaration_file_extension(path);
    if !declaration_extension.is_empty() {
        let mut result = remove_extension(path, &declaration_extension).to_vec();
        if !new_extension.starts_with(b".") {
            result.push(b'.');
        }
        result.extend_from_slice(new_extension);
        return result;
    }
    change_extension(path, new_extension)
}

pub fn get_possible_original_input_extension_for_extension(path: &[u8]) -> Vec<Vec<u8>> {
    if file_extension_is_one_of(path, &[EXTENSION_DMTS, EXTENSION_MJS, EXTENSION_MTS]) {
        return vec![EXTENSION_MTS.to_vec(), EXTENSION_MJS.to_vec()];
    }
    if file_extension_is_one_of(path, &[EXTENSION_DCTS, EXTENSION_CJS, EXTENSION_CTS]) {
        return vec![EXTENSION_CTS.to_vec(), EXTENSION_CJS.to_vec()];
    }
    // Handle any custom .d.x.ts extension (e.g., .d.json.ts -> .json, .d.css.ts -> .css)
    let ext = get_declaration_file_extension(path);
    if !ext.is_empty() && ext != EXTENSION_DTS {
        let inner = ext
            .get(b".d.".len()..ext.len().saturating_sub(b".ts".len()))
            .unwrap_or(&[]);
        let mut dotted = b".".to_vec();
        dotted.extend_from_slice(inner);
        return vec![dotted];
    }
    vec![
        EXTENSION_TSX.to_vec(),
        EXTENSION_TS.to_vec(),
        EXTENSION_JSX.to_vec(),
        EXTENSION_JS.to_vec(),
    ]
}
