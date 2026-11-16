//! `--desktop`: the `.app`, AppDir or folder around the executable of a `bun:desktop` app.

use std::io::Write as _;

use bstr::BStr;
use bun_ast::E::{JsonValue, ObjectJSON};
use bun_core::env::OperatingSystem;
use bun_core::fmt::quote;
use bun_core::{ZBox, strings};
use bun_options_types::compile_target::CompileTarget;
use bun_options_types::context::ContextData;
use bun_options_types::{DesktopOptions, WindowsOptions};
use bun_parsers::json::ParsedJson;
use bun_paths::resolve_path::{join_abs_string_spill, platform};
use bun_standalone_graph::StandaloneModuleGraph::CompileError;
use bun_standalone_graph::desktop::{Layout, library_for};
use bun_sys::{Fd, File, O};

use super::script_or_command::nearest_package_json;

type Result<T> = core::result::Result<T, CompileError>;

macro_rules! fail {
    ($($argument:tt)*) => {
        return Err(CompileError::fmt(format_args!($($argument)*)))
    };
}

/// `src/js/internal/desktop/app.ts` reads it. It also tells a bundle of an earlier build from another directory.
const MANIFEST: &[u8] = b"desktop.json";

const KEYS: [&[u8]; 11] = [
    b"name",
    b"identifier",
    b"version",
    b"description",
    b"copyright",
    b"icon",
    b"category",
    b"urlSchemes",
    b"fileAssociations",
    b"resources",
    b"infoPlist",
];

/// The suffix of `public.app-category.*`, and freedesktop.org's categories.
const CATEGORIES: [(&[u8], &[u8]); 20] = [
    (b"business", b"Office;"),
    (b"developer-tools", b"Development;"),
    (b"education", b"Education;"),
    (b"entertainment", b"AudioVideo;"),
    (b"finance", b"Office;Finance;"),
    (b"games", b"Game;"),
    (b"graphics-design", b"Graphics;"),
    (b"healthcare-fitness", b"Utility;"),
    (b"lifestyle", b"Utility;"),
    (b"medical", b"Science;MedicalSoftware;"),
    (b"music", b"AudioVideo;Audio;"),
    (b"news", b"Network;News;"),
    (b"photography", b"Graphics;Photography;"),
    (b"productivity", b"Office;"),
    (b"reference", b"Education;"),
    (b"social-networking", b"Network;Chat;"),
    (b"sports", b"Education;Sports;"),
    (b"travel", b"Utility;"),
    (b"utilities", b"Utility;"),
    (b"video", b"AudioVideo;Video;"),
];

struct GeneratedFile {
    path: Vec<u8>,
    /// Of a link, its target.
    bytes: Vec<u8>,
    is_link: bool,
}

struct Resource {
    from: Vec<u8>,
    to: Vec<u8>,
}

/// All paths are absolute.
pub(crate) struct DesktopBundle {
    /// As the summary of the build shows it.
    pub(crate) shown_path: Vec<u8>,
    pub(crate) executable: Vec<u8>,
    root: Vec<u8>,
    library: Vec<u8>,
    files: Vec<GeneratedFile>,
    resources: Vec<Resource>,
}

pub(crate) struct Request<'a> {
    pub(crate) options: &'a DesktopOptions,
    pub(crate) target: &'a CompileTarget,
    pub(crate) working_directory: &'a [u8],
    pub(crate) entry_point: &'a [u8],
    /// Below the working directory, or nothing.
    pub(crate) outdir: &'a [u8],
    /// The bundle, or nothing.
    pub(crate) outfile: &'a [u8],
}

fn join(base: &[u8], parts: &[&[u8]]) -> Vec<u8> {
    let mut spill = Vec::new();
    join_abs_string_spill::<platform::Auto>(base, &mut spill, parts).to_vec()
}

fn strip_suffix_in_any_case<'a>(name: &'a [u8], suffix: &[u8]) -> &'a [u8] {
    match name.split_at_checked(name.len().wrapping_sub(suffix.len())) {
        Some((stem, end)) if end.eq_ignore_ascii_case(suffix) => stem,
        _ => name,
    }
}

// ───────────────────────────── settings ─────────────────────────────

/// An object of settings, and the directory that its paths are relative to.
struct Layer<'a> {
    object: &'a ObjectJSON,
    directory: &'a [u8],
    label: &'static str,
}

struct Setting<'a> {
    value: &'a JsonValue,
    directory: &'a [u8],
    label: String,
}

impl<'a> Setting<'a> {
    fn string(&self) -> Result<&'a [u8]> {
        match self.value.as_str() {
            Some(text) => Ok(text),
            None => fail!("{} must be a string", self.label),
        }
    }

    fn items(&self) -> Result<&'a [JsonValue]> {
        match self.value.as_array() {
            Some(array) => Ok(array.items()),
            None => fail!("{} must be an array", self.label),
        }
    }

    fn strings(&self) -> Result<Vec<&'a [u8]>> {
        strings_of(self.value, &self.label)
    }
}

fn strings_of<'a>(value: &'a JsonValue, label: &str) -> Result<Vec<&'a [u8]>> {
    let items = match value.as_array() {
        Some(array) => array.items(),
        None => core::slice::from_ref(value),
    };
    match items.iter().map(JsonValue::as_str).collect() {
        Some(texts) => Ok(texts),
        None => fail!("{label} must be a string or an array of strings"),
    }
}

struct Layers<'a>(Vec<Layer<'a>>);

impl<'a> Layers<'a> {
    fn check_keys(&self) -> Result<()> {
        for layer in &self.0 {
            for property in layer.object.properties() {
                if !KEYS.contains(&property.key.slice()) {
                    fail!(
                        "{} has the unknown key {}. The keys are: {}",
                        layer.label,
                        quote(property.key.slice()),
                        BStr::new(&KEYS.join(&b", "[..]))
                    );
                }
            }
        }
        Ok(())
    }

    fn get(&self, key: &str) -> Option<Setting<'a>> {
        self.0.iter().find_map(|layer| {
            let value = layer.object.get(key.as_bytes())?;
            (!matches!(value, JsonValue::Null)).then(|| Setting {
                value,
                directory: layer.directory,
                label: format!("\"{key}\" of {}", layer.label),
            })
        })
    }

    fn string(&self, key: &str) -> Result<Option<&'a [u8]>> {
        self.get(key).map(|setting| setting.string()).transpose()
    }
}

struct FileAssociation<'a> {
    extensions: Vec<&'a [u8]>,
    name: &'a [u8],
    mime_type: Vec<u8>,
    defines_mime_type: bool,
    role: &'a [u8],
}

struct Metadata<'a> {
    name: &'a [u8],
    identifier: Vec<u8>,
    version: &'a [u8],
    description: Option<&'a [u8]>,
    copyright: Option<&'a [u8]>,
    category: Option<(&'static [u8], &'static [u8])>,
    url_schemes: Vec<&'a [u8]>,
    file_associations: Vec<FileAssociation<'a>>,
    info_plist: Option<&'a ObjectJSON>,
    executable_name: Vec<u8>,
}

fn has_control_character(text: &[u8]) -> bool {
    text.iter().any(u8::is_ascii_control)
}

fn check_text(label: &str, text: &[u8]) -> Result<()> {
    if has_control_character(text) || !strings::is_valid_utf8(text) {
        fail!("{label} has a control character or is not UTF-8");
    }
    Ok(())
}

fn check_name(name: &[u8]) -> Result<()> {
    check_text("The name of the app", name)?;
    if name.is_empty()
        || name.len() > 200
        || strings::index_of_any(name, b"/\\").is_some()
        || matches!(name[0], b'.' | b' ' | b'-')
        || matches!(name[name.len() - 1], b'.' | b' ')
    {
        fail!(
            "{} cannot be the name of an app. A name has 1 to 200 bytes and no slash, does not start with a dot, a space or a hyphen, and does not end with a dot or a space",
            quote(name)
        );
    }
    Ok(())
}

fn check_identifier(identifier: &[u8]) -> Result<()> {
    let is_part = |part: &[u8]| {
        !part.is_empty()
            && part[0] != b'-'
            && (part.iter()).all(|&byte| byte.is_ascii_alphanumeric() || byte == b'-')
    };
    if identifier.len() > 155
        || !strings::contains_char(identifier, b'.')
        || !strings::split(identifier, b".").all(is_part)
    {
        fail!(
            "{} cannot be the identifier of an app. Use letters, digits and hyphens in reverse-DNS form, such as com.example.notes",
            quote(identifier)
        );
    }
    Ok(())
}

/// `1.2.3` of `1.2.3-beta.1`, which is all that `Info.plist` and a Windows executable take.
fn numeric_version(version: &[u8]) -> &[u8] {
    &version[..strings::index_of_any(version, b"-+").unwrap_or(version.len())]
}

fn check_version(version: &[u8]) -> Result<()> {
    let is_number = |part: &[u8]| {
        part.iter().all(u8::is_ascii_digit)
            && strings::str_utf8(part).is_some_and(|digits| digits.parse::<u32>().is_ok())
    };
    let numeric = numeric_version(version);
    let is_allowed =
        |&byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+');
    if strings::count_char(numeric, b'.') > 2
        || !strings::split(numeric, b".").all(is_number)
        || !version.iter().all(is_allowed)
    {
        fail!(
            "{} cannot be the version of an app. Use a version such as 1.2.3 or 1.2.3-beta.1",
            quote(version)
        );
    }
    Ok(())
}

fn words(name: &[u8]) -> Vec<u8> {
    let mut joined = Vec::new();
    for &byte in name {
        if byte.is_ascii_alphanumeric() {
            joined.push(byte.to_ascii_lowercase());
        } else if joined.last().is_some_and(|last| *last != b'-') {
            joined.push(b'-');
        }
    }
    joined.pop_if(|last| *last == b'-');
    if joined.is_empty() {
        joined.extend_from_slice(b"app");
    }
    joined
}

/// The same as `identifier` in `src/js/internal/desktop/app.ts`.
fn default_identifier(name: &[u8]) -> Vec<u8> {
    [&b"sh.bun.app."[..], &words(name)].concat()
}

fn file_name(name: &[u8]) -> Vec<u8> {
    let replace = |&byte: &u8| match byte {
        b'<' | b'>' | b':' | b'"' | b'|' | b'?' | b'*' => b'-',
        byte => byte,
    };
    name.iter().map(replace).collect()
}

fn is_windows_device(name: &[u8]) -> bool {
    let stem = strings::split(name, b".").next().unwrap_or(name);
    match &*stem.trim_ascii_end().to_ascii_lowercase() {
        b"con" | b"prn" | b"aux" | b"nul" => true,
        [b'c', b'o', b'm', digit] | [b'l', b'p', b't', digit] => digit.is_ascii_digit(),
        _ => false,
    }
}

fn name_of_entry_point(entry_point: &[u8]) -> &[u8] {
    let file = bun_paths::basename(entry_point);
    match &file[..file.len() - bun_paths::extension(file).len()] {
        b"index" | b"bun" => bun_paths::basename(bun_paths::dirname_simple(entry_point)),
        stem => stem,
    }
}

fn read_url_schemes<'a>(layers: &Layers<'a>) -> Result<Vec<&'a [u8]>> {
    let Some(setting) = layers.get("urlSchemes") else {
        return Ok(Vec::new());
    };
    let schemes = setting.strings()?;
    let is_allowed =
        |&byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.');
    for scheme in &schemes {
        if !scheme.first().is_some_and(u8::is_ascii_alphabetic) || !scheme.iter().all(is_allowed) {
            fail!(
                "{} has {}, which is not a URL scheme",
                setting.label,
                quote(scheme)
            );
        }
    }
    Ok(schemes)
}

fn read_file_associations<'a>(
    layers: &Layers<'a>,
    identifier: &[u8],
) -> Result<Vec<FileAssociation<'a>>> {
    let Some(setting) = layers.get("fileAssociations") else {
        return Ok(Vec::new());
    };
    let label = &setting.label;
    let is_token = |text: &[u8]| {
        let is_allowed =
            |&byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.' | b'_');
        !text.is_empty() && text.iter().all(is_allowed)
    };
    let mut associations = Vec::new();
    for item in setting.items()? {
        let Some((object, extensions)) = item
            .as_object()
            .and_then(|object| Some((object, object.get(b"extensions")?)))
        else {
            fail!("{label} must have objects like {{ \"extensions\": [\"md\"] }}");
        };
        let extensions: Vec<&[u8]> = strings_of(extensions, "\"extensions\"")?
            .into_iter()
            .map(|extension| extension.strip_prefix(b".").unwrap_or(extension))
            .collect();
        if extensions.is_empty() || !extensions.iter().all(|extension| is_token(extension)) {
            fail!("{label} has an invalid list of extensions");
        }
        let member = |key: &str| match object.get(key.as_bytes()) {
            None => Ok(None),
            Some(JsonValue::String(text)) => Ok(Some(text.slice())),
            Some(_) => fail!("\"{key}\" in {label} must be a string"),
        };
        let name = member("name")?.unwrap_or(extensions[0]);
        check_text(label, name)?;
        let role = member("role")?.unwrap_or(b"Editor");
        if !matches!(role, b"Editor" | b"Viewer") {
            fail!("\"role\" in {label} must be \"Editor\" or \"Viewer\"");
        }
        let mime_type = member("mimeType")?;
        if let Some(mime_type) = mime_type
            && !strings::split_once_char(mime_type, b'/')
                .is_some_and(|(kind, subtype)| is_token(kind) && is_token(subtype))
        {
            fail!("{label} has {}, which is not a MIME type", quote(mime_type));
        }
        associations.push(FileAssociation {
            mime_type: mime_type.map_or_else(
                || [b"application/x-", identifier, b".", extensions[0]].concat(),
                <[u8]>::to_vec,
            ),
            defines_mime_type: mime_type.is_none(),
            extensions,
            name,
            role,
        });
    }
    Ok(associations)
}

fn read_resources(layers: &Layers<'_>, directory: &[u8]) -> Result<Vec<Resource>> {
    let Some(setting) = layers.get("resources") else {
        return Ok(Vec::new());
    };
    let label = &setting.label;
    let mut resources: Vec<Resource> = Vec::new();
    for item in setting.items()? {
        let member = |key: &[u8]| item.as_object()?.get(key)?.as_str();
        let Some(written) = item.as_str().or_else(|| member(b"from")) else {
            fail!(
                "{label} must have paths, or objects like {{ \"from\": \"..\", \"to\": \"..\" }}"
            );
        };
        check_text(label, written)?;
        let from = join(setting.directory, &[written]);
        if !bun_sys::exists(&from) {
            fail!("{label} has {}, which does not exist", quote(written));
        }
        let to = member(b"to").unwrap_or_else(|| bun_paths::basename(&from));
        let is_part = |part: &[u8]| !matches!(part, b"" | b"." | b"..");
        if has_control_character(to)
            || strings::index_of_any(to, b"\\:").is_some()
            || !strings::split(to, b"/").all(is_part)
        {
            fail!(
                "{label} cannot put a file at {}. Use a relative path without \"..\"",
                quote(to)
            );
        }
        let to = join(directory, &[to]);
        resources.push(Resource { from, to });
    }
    Ok(resources)
}

// ───────────────────────────── text formats ─────────────────────────────

fn write_xml_text(out: &mut Vec<u8>, text: &[u8]) {
    for &byte in text {
        match byte {
            b'&' => out.extend_from_slice(b"&amp;"),
            b'<' => out.extend_from_slice(b"&lt;"),
            b'>' => out.extend_from_slice(b"&gt;"),
            b'"' => out.extend_from_slice(b"&quot;"),
            b'\'' => out.extend_from_slice(b"&apos;"),
            byte => out.push(byte),
        }
    }
}

enum Plist<'a> {
    String(&'a [u8]),
    Bool(bool),
    Number(f64),
    Array(Vec<Plist<'a>>),
    Dict(Vec<(&'a [u8], Plist<'a>)>),
}

impl<'a> Plist<'a> {
    fn strings(texts: &[&'a [u8]]) -> Self {
        Plist::Array(texts.iter().map(|text| Plist::String(text)).collect())
    }

    fn from_json(value: &'a JsonValue, depth: usize) -> Result<Self> {
        // XML 1.0 cannot spell the others.
        let check = |text: &[u8]| {
            let is_refused = |byte: &u8| *byte < 0x20 && !matches!(byte, b'\t' | b'\n');
            if text.iter().any(is_refused) || !strings::is_valid_utf8(text) {
                fail!("\"infoPlist\" has a control character or text that is not UTF-8");
            }
            Ok(())
        };
        if depth > 32 {
            fail!("\"infoPlist\" is nested too deeply");
        }
        Ok(match value {
            JsonValue::Null => fail!("\"infoPlist\" can only have null as the value of a key"),
            JsonValue::Boolean(value) => Plist::Bool(*value),
            JsonValue::Number(number) => Plist::Number(number.value()),
            JsonValue::String(text) => {
                check(text.slice())?;
                Plist::String(text.slice())
            }
            JsonValue::Array(array) => Plist::Array(
                (array.get().items().iter())
                    .map(|item| Plist::from_json(item, depth + 1))
                    .collect::<Result<_>>()?,
            ),
            JsonValue::Object(object) => {
                let mut entries = Vec::new();
                for property in object.get().properties() {
                    check(property.key.slice())?;
                    if !matches!(property.value, JsonValue::Null) {
                        let value = Plist::from_json(&property.value, depth + 1)?;
                        entries.push((property.key.slice(), value));
                    }
                }
                Plist::Dict(entries)
            }
        })
    }

    fn write(&self, out: &mut Vec<u8>, depth: usize) {
        let indent = |out: &mut Vec<u8>, depth| out.extend(core::iter::repeat_n(b'\t', depth));
        indent(out, depth);
        match self {
            Plist::String(text) => {
                out.extend_from_slice(b"<string>");
                write_xml_text(out, text);
                out.extend_from_slice(b"</string>\n");
            }
            Plist::Bool(true) => out.extend_from_slice(b"<true/>\n"),
            Plist::Bool(false) => out.extend_from_slice(b"<false/>\n"),
            Plist::Number(number) if number.fract() == 0.0 && number.abs() < 9e15 => {
                let _ = writeln!(out, "<integer>{}</integer>", *number as i64);
            }
            Plist::Number(number) => {
                let _ = writeln!(out, "<real>{number}</real>");
            }
            Plist::Array(items) => {
                out.extend_from_slice(b"<array>\n");
                for item in items {
                    item.write(out, depth + 1);
                }
                indent(out, depth);
                out.extend_from_slice(b"</array>\n");
            }
            Plist::Dict(entries) => {
                out.extend_from_slice(b"<dict>\n");
                for (key, value) in entries {
                    indent(out, depth + 1);
                    out.extend_from_slice(b"<key>");
                    write_xml_text(out, key);
                    out.extend_from_slice(b"</key>\n");
                    value.write(out, depth + 1);
                }
                indent(out, depth);
                out.extend_from_slice(b"</dict>\n");
            }
        }
    }
}

fn info_plist(app: &Metadata<'_>, has_icon: bool) -> Result<Vec<u8>> {
    let version = numeric_version(app.version);
    let category = (app.category).map(|(name, _)| [b"public.app-category.", name].concat());
    let mut entries: Vec<(&[u8], Plist<'_>)> = vec![
        (b"CFBundleDevelopmentRegion", Plist::String(b"en")),
        (b"CFBundleDisplayName", Plist::String(app.name)),
        (b"CFBundleExecutable", Plist::String(&app.executable_name)),
        (b"CFBundleIdentifier", Plist::String(&app.identifier)),
        (b"CFBundleInfoDictionaryVersion", Plist::String(b"6.0")),
        (b"CFBundleName", Plist::String(app.name)),
        (b"CFBundlePackageType", Plist::String(b"APPL")),
        (b"CFBundleShortVersionString", Plist::String(version)),
        (b"CFBundleVersion", Plist::String(version)),
        (b"LSMinimumSystemVersion", Plist::String(b"13.0")),
        (b"NSHighResolutionCapable", Plist::Bool(true)),
        (b"NSSupportsAutomaticGraphicsSwitching", Plist::Bool(true)),
    ];
    if has_icon {
        entries.push((b"CFBundleIconFile", Plist::String(b"icon.icns")));
    }
    if let Some(category) = &category {
        entries.push((b"LSApplicationCategoryType", Plist::String(category)));
    }
    if let Some(copyright) = app.copyright {
        entries.push((b"NSHumanReadableCopyright", Plist::String(copyright)));
    }
    if !app.url_schemes.is_empty() {
        let url_type = Plist::Dict(vec![
            (b"CFBundleURLName", Plist::String(&app.identifier)),
            (b"CFBundleURLSchemes", Plist::strings(&app.url_schemes)),
        ]);
        entries.push((b"CFBundleURLTypes", Plist::Array(vec![url_type])));
    }
    if !app.file_associations.is_empty() {
        let types = app.file_associations.iter().map(|association| {
            let extensions = Plist::strings(&association.extensions);
            Plist::Dict(vec![
                (b"CFBundleTypeExtensions", extensions),
                (b"CFBundleTypeName", Plist::String(association.name)),
                (b"CFBundleTypeRole", Plist::String(association.role)),
            ])
        });
        entries.push((b"CFBundleDocumentTypes", Plist::Array(types.collect())));
    }
    for property in app.info_plist.map_or(&[][..], ObjectJSON::properties) {
        let key = property.key.slice();
        if matches!(key, b"CFBundleExecutable" | b"CFBundleIdentifier") {
            fail!("\"infoPlist\" cannot set {}", BStr::new(key));
        }
        check_text("\"infoPlist\"", key)?;
        entries.retain(|entry| entry.0 != key);
        if !matches!(property.value, JsonValue::Null) {
            entries.push((key, Plist::from_json(&property.value, 0)?));
        }
    }
    let mut out = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n".to_vec();
    Plist::Dict(entries).write(&mut out, 0);
    out.extend_from_slice(b"</plist>\n");
    Ok(out)
}

fn desktop_entry(app: &Metadata<'_>, has_icon: bool) -> Vec<u8> {
    let mut out = b"[Desktop Entry]\nType=Application\n".to_vec();
    let mut line = |key: &[u8], value: &[u8]| {
        let value = strings::replace_owned(value, b"\\", b"\\\\");
        let (space, rest): (&[u8], _) = match value.strip_prefix(b" ") {
            Some(rest) => (b"\\s", rest),
            None => (b"", &value[..]),
        };
        out.extend_from_slice(&[key, b"=", space, rest, b"\n"].concat());
    };
    line(b"Name", app.name);
    if let Some(description) = app.description {
        line(b"Comment", description);
    }
    line(b"Exec", &[&app.executable_name, &b" %U"[..]].concat());
    if has_icon {
        line(b"Icon", &app.identifier);
    }
    line(b"Terminal", b"false");
    line(b"Categories", app.category.map_or(b"Utility;", |it| it.1));
    line(b"StartupWMClass", &app.identifier);
    let mut mime_types = Vec::new();
    for association in &app.file_associations {
        mime_types.extend_from_slice(&[&association.mime_type, &b";"[..]].concat());
    }
    for scheme in &app.url_schemes {
        mime_types.extend_from_slice(&[b"x-scheme-handler/", *scheme, b";"].concat());
    }
    if !mime_types.is_empty() {
        line(b"MimeType", &mime_types);
    }
    line(b"X-AppImage-Version", app.version);
    out
}

fn mime_info(app: &Metadata<'_>) -> Option<Vec<u8>> {
    let mut types = Vec::new();
    for association in (app.file_associations.iter()).filter(|it| it.defines_mime_type) {
        let mime_type = BStr::new(&association.mime_type);
        let _ = write!(types, "\t<mime-type type=\"{mime_type}\">\n\t\t<comment>");
        write_xml_text(&mut types, association.name);
        types.extend_from_slice(b"</comment>\n");
        for extension in &association.extensions {
            let _ = writeln!(types, "\t\t<glob pattern=\"*.{}\"/>", BStr::new(extension));
        }
        types.extend_from_slice(b"\t</mime-type>\n");
    }
    let head = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<mime-info xmlns=\"http://www.freedesktop.org/standards/shared-mime-info\">\n";
    (!types.is_empty()).then(|| [head, &types[..], b"</mime-info>\n"].concat())
}

fn manifest(app: &Metadata<'_>) -> Vec<u8> {
    let json = |text| bun_core::fmt::format_json_string_utf8(text, Default::default());
    format!(
        "{{\n  \"name\": {},\n  \"version\": {},\n  \"identifier\": {}\n}}\n",
        json(app.name),
        json(app.version),
        json(&app.identifier),
    )
    .into_bytes()
}

// ───────────────────────────── icons ─────────────────────────────

struct Picture {
    size: u32,
    rgba: Vec<u8>,
}

impl Picture {
    fn decode(path: &[u8], bytes: &[u8]) -> Result<Picture> {
        let Ok(decoder) = bun_png::Decoder::new(bytes) else {
            fail!("The icon {} is not a PNG", quote(path));
        };
        let bun_png::Header { width, height, .. } = decoder.header();
        if width != height || !(16..=4096).contains(&width) {
            fail!(
                "The icon {} has {width}x{height} pixels. It must be square, with 16 to 4096 pixels on a side",
                quote(path)
            );
        }
        let Ok(image) = decoder.decode() else {
            fail!("The icon {} is not a PNG", quote(path));
        };
        Ok(Picture {
            size: width,
            rgba: image.rgba,
        })
    }

    /// The mean of the pixels that each one covers, weighted by alpha so that no transparent color shows at the edges.
    fn scaled_down(&self, size: u32) -> Vec<u8> {
        let (from, to) = (self.size as usize, size as usize);
        let pixels = self.rgba.as_chunks::<4>().0;
        let covered = |index: usize| index * from / to..((index + 1) * from).div_ceil(to);
        let weight = |index: usize, source: usize| {
            (((source + 1) * to).min((index + 1) * from) - (source * to).max(index * from)) as u64
        };
        let area = (from * from) as u64;
        let mut out = Vec::with_capacity(to * to * 4);
        for y in 0..to {
            for x in 0..to {
                let mut sums = [0u64; 4];
                for source_y in covered(y) {
                    for source_x in covered(x) {
                        let [r, g, b, a] = pixels[source_y * from + source_x].map(u64::from);
                        let alpha = a * weight(y, source_y) * weight(x, source_x);
                        sums[0] += r * alpha;
                        sums[1] += g * alpha;
                        sums[2] += b * alpha;
                        sums[3] += alpha;
                    }
                }
                let alpha = sums[3].max(1);
                out.extend(
                    sums[..3]
                        .iter()
                        .map(|sum| ((sum + alpha / 2) / alpha) as u8),
                );
                out.push(((sums[3] + area / 2) / area) as u8);
            }
        }
        out
    }

    /// The sizes that need no enlarging.
    fn encode_at(&self, sizes: &[u32]) -> Result<Vec<(u32, Vec<u8>)>> {
        let mut encoded = Vec::new();
        for &size in sizes.iter().filter(|size| **size <= self.size) {
            match bun_png::encode(&self.scaled_down(size), size, size, None, -1, None) {
                Ok(png) => encoded.push((size, png)),
                Err(_) => fail!("Failed to write the icon at {size}x{size} pixels"),
            }
        }
        Ok(encoded)
    }

    fn icns(&self) -> Result<Vec<u8>> {
        const TYPES: [(&[u8; 4], u32); 10] = [
            (b"icp4", 16),
            (b"icp5", 32),
            (b"ic11", 32),
            (b"ic12", 64),
            (b"ic07", 128),
            (b"ic08", 256),
            (b"ic13", 256),
            (b"ic09", 512),
            (b"ic14", 512),
            (b"ic10", 1024),
        ];
        let mut out = b"icns\0\0\0\0".to_vec();
        for (size, png) in self.encode_at(&[16, 32, 64, 128, 256, 512, 1024])? {
            for (kind, _) in TYPES.iter().filter(|it| it.1 == size) {
                out.extend_from_slice(*kind);
                out.extend_from_slice(&(png.len() as u32 + 8).to_be_bytes());
                out.extend_from_slice(&png);
            }
        }
        let length = out.len() as u32;
        out[4..8].copy_from_slice(&length.to_be_bytes());
        Ok(out)
    }

    fn ico(&self) -> Result<Vec<u8>> {
        let images = self.encode_at(&[16, 24, 32, 48, 64, 128, 256])?;
        let mut out = vec![0, 0, 1, 0, images.len() as u8, 0];
        let mut offset = out.len() + images.len() * 16;
        for (size, png) in &images {
            // 256 is written as 0.
            out.extend_from_slice(&[*size as u8, *size as u8, 0, 0, 1, 0, 32, 0]);
            out.extend_from_slice(&(png.len() as u32).to_le_bytes());
            out.extend_from_slice(&(offset as u32).to_le_bytes());
            offset += png.len();
        }
        for (_, png) in &images {
            out.extend_from_slice(png);
        }
        Ok(out)
    }
}

struct Icons {
    picture: Option<Picture>,
    /// The `.icns`, `.svg` or `.ico` for the target.
    native: Option<Vec<u8>>,
}

fn read_icons(paths: &[Vec<u8>], os: OperatingSystem) -> Result<Icons> {
    let native_extension: &[u8] = match os {
        OperatingSystem::Mac => b".icns",
        OperatingSystem::Windows => b".ico",
        _ => b".svg",
    };
    let find = |extension: &[u8]| {
        let has_it = |path: &&Vec<u8>| bun_paths::extension(path).eq_ignore_ascii_case(extension);
        let Some(path) = paths.iter().find(has_it) else {
            return Ok(None);
        };
        match File::read_from(Fd::cwd(), path) {
            Ok(bytes) => Ok(Some((path, bytes))),
            Err(error) => fail!("Failed to read the icon {}: {error}", quote(path)),
        }
    };
    let icons = Icons {
        picture: find(b".png")?
            .map(|(path, bytes)| Picture::decode(path, &bytes))
            .transpose()?,
        native: find(native_extension)?.map(|found| found.1),
    };
    if let (Some(path), None, None) = (paths.first(), &icons.picture, &icons.native) {
        fail!(
            "The icon {} cannot be used for this target. Use a .png or a {} file",
            quote(path),
            BStr::new(native_extension)
        );
    }
    Ok(icons)
}

// ───────────────────────────── the bundle ─────────────────────────────

fn parse_object<'a>(parsed: &'a ParsedJson) -> Option<&'a ObjectJSON> {
    match &parsed.root.data {
        bun_ast::ExprData::EObjectJSON(object) => Some(object.get()),
        _ => None,
    }
}

/// A build that failed leaves directories.
fn has_only_directories(path: &[u8]) -> bool {
    let Ok(directory) = bun_sys::open_dir_for_iteration(Fd::cwd(), path).map(File::from_fd) else {
        return false;
    };
    let Ok(mut walker) = bun_sys::walker_skippable::walk(directory.fd(), &[], &[]) else {
        bun_core::out_of_memory();
    };
    walker.resolve_unknown_entry_types = true;
    loop {
        match walker.next() {
            Ok(Some(entry)) if entry.kind == bun_sys::EntryKind::Directory => {}
            Ok(None) => return true,
            Ok(Some(_)) | Err(_) => return false,
        }
    }
}

impl DesktopBundle {
    /// Reads and checks the settings, and writes nothing. Fills in what `windows` leaves open.
    pub(crate) fn plan(request: &Request<'_>, windows: &mut WindowsOptions) -> Result<Self> {
        let Request {
            options,
            target,
            working_directory,
            ..
        } = *request;
        if target.desktop_package().is_none() {
            fail!("bun:desktop is not available for '{target}'");
        }

        bun_ast::initialize_store();
        let mut log = bun_ast::Log::init();
        let written = bun_ast::Source::init_path_string(b"compile.desktop", &options.json[..]);
        let Ok(written) = ParsedJson::parse_json(&written, &mut log) else {
            fail!("compile.desktop must be a boolean or an object");
        };
        let entry_point = join(working_directory, &[request.entry_point]);
        let found = nearest_package_json(bun_paths::dirname_simple(&entry_point));
        let (package_directory, package_path, package_text) = found.unwrap_or_default();
        let package = bun_ast::Source::init_path_string(&package_path[..], &package_text[..]);
        let Ok(package) = ParsedJson::parse_package_json(&package, &mut log) else {
            fail!("Failed to parse {}", BStr::new(&package_path));
        };
        let package = parse_object(&package);
        let in_package = |key: &[u8]| package?.get(key)?.as_str().filter(|it| !it.is_empty());

        let mut layers = Layers(Vec::new());
        layers.0.extend(parse_object(&written).map(|object| Layer {
            object,
            directory: working_directory,
            label: "compile.desktop",
        }));
        if let Some(value) = package.and_then(|package| package.get(b"desktop")) {
            let Some(object) = value.as_object() else {
                fail!("\"desktop\" in package.json must be an object");
            };
            layers.0.push(Layer {
                object,
                directory: package_directory,
                label: "\"desktop\" in package.json",
            });
        }
        layers.check_keys()?;

        let bundle_extension: &[u8] = match target.os {
            OperatingSystem::Mac => b".app",
            OperatingSystem::Windows => b".exe",
            _ => b".AppDir",
        };
        let outfile = strings::without_trailing_slash(request.outfile);
        let outfile_stem = strip_suffix_in_any_case(outfile, bundle_extension);
        let outfile_name = bun_paths::basename(outfile_stem);
        if !request.outfile.is_empty() && matches!(outfile_name, b"" | b"." | b"..") {
            fail!("{} does not name a bundle", quote(request.outfile));
        }

        let name = match options.name.as_deref() {
            Some(name) => name,
            None => (layers.string("name")?)
                .or_else(|| in_package(b"productName"))
                .or_else(|| in_package(b"name").map(strings::basename_posix))
                .or_else(|| (!outfile_name.is_empty()).then_some(outfile_name))
                .unwrap_or_else(|| name_of_entry_point(&entry_point)),
        };
        check_name(name)?;
        let identifier = match options.identifier.as_deref() {
            Some(identifier) => Some(identifier),
            None => layers.string("identifier")?,
        };
        let identifier = identifier.map_or_else(|| default_identifier(name), <[u8]>::to_vec);
        check_identifier(&identifier)?;
        let version = match options.version.as_deref() {
            Some(version) => version,
            None => (layers.string("version")?)
                .or_else(|| in_package(b"version"))
                .unwrap_or(b"0.0.0"),
        };
        check_version(version)?;
        let description = (layers.string("description")?).or_else(|| in_package(b"description"));
        let copyright = layers.string("copyright")?;
        check_text("The description", description.unwrap_or_default())?;
        check_text("The copyright", copyright.unwrap_or_default())?;
        let category = match layers.string("category")? {
            None => None,
            Some(written) => match CATEGORIES.iter().find(|it| it.0 == written) {
                Some(category) => Some(*category),
                None => fail!(
                    "{} is not a category. The categories are: {}",
                    quote(written),
                    BStr::new(&CATEGORIES.map(|it| it.0).join(&b", "[..]))
                ),
            },
        };
        let info_plist_entries = match layers.get("infoPlist") {
            None => None,
            Some(setting) => match setting.value.as_object() {
                Some(object) => Some(object),
                None => fail!("{} must be an object", setting.label),
            },
        };
        let executable_name = match target.os {
            OperatingSystem::Mac | OperatingSystem::Windows => file_name(name),
            _ => words(name),
        };
        // An executable of that name does not look for its program.
        if matches!(&*executable_name.to_ascii_lowercase(), b"bun" | b"bunx")
            || (target.os == OperatingSystem::Windows && is_windows_device(&executable_name))
        {
            fail!("{} cannot be the name of an app", quote(name));
        }
        let app = Metadata {
            name,
            version,
            description,
            copyright,
            category,
            url_schemes: read_url_schemes(&layers)?,
            file_associations: read_file_associations(&layers, &identifier)?,
            info_plist: info_plist_entries,
            identifier,
            executable_name,
        };
        let icon_paths = match (options.icon.as_deref(), layers.get("icon")) {
            (Some(icon), _) => vec![join(working_directory, &[icon])],
            (None, Some(setting)) => (setting.strings()?.iter())
                .map(|path| join(setting.directory, &[path]))
                .collect(),
            (None, None) => Vec::new(),
        };
        let icons = read_icons(&icon_paths, target.os)?;

        let shown_path = match (target.os, outfile_stem) {
            (OperatingSystem::Windows, b"") => app.executable_name.clone(),
            (OperatingSystem::Windows, stem) => stem.to_vec(),
            (_, b"") => [&app.executable_name, bundle_extension].concat(),
            (_, stem) if stem.len() == outfile.len() => [stem, bundle_extension].concat(),
            _ => outfile.to_vec(),
        };
        let root = join(working_directory, &[request.outdir, &shown_path]);
        let executable = match target.os {
            OperatingSystem::Mac => join(&root, &[b"Contents/MacOS", &app.executable_name]),
            OperatingSystem::Windows => {
                join(&root, &[&[&app.executable_name, &b".exe"[..]].concat()])
            }
            _ => join(&root, &[b"usr/bin", &app.executable_name]),
        };
        let layout = Layout::of(target.os, &executable);
        let manifest_path = join(&layout.resources, &[MANIFEST]);

        let mut files = Vec::new();
        let mut add = |path: Vec<u8>, bytes: Vec<u8>| {
            files.push(GeneratedFile {
                path,
                bytes,
                is_link: false,
            });
        };
        add(manifest_path.clone(), manifest(&app));
        match target.os {
            OperatingSystem::Mac => {
                let icns = match (icons.native, &icons.picture) {
                    (None, Some(picture)) => Some(picture.icns()?),
                    (native, _) => native,
                };
                let plist = info_plist(&app, icns.is_some())?;
                add(join(&root, &[b"Contents/Info.plist"]), plist);
                add(join(&root, &[b"Contents/PkgInfo"]), b"APPL????".to_vec());
                if let Some(icns) = icns {
                    add(join(&layout.resources, &[b"icon.icns"]), icns);
                }
            }
            OperatingSystem::Windows => {
                let ico = match (icons.native, &icons.picture) {
                    (None, Some(picture)) => Some(picture.ico()?),
                    (native, _) => native,
                };
                if let Some(ico) = ico {
                    let path = join(&layout.resources, &[b"icon.ico"]);
                    windows.icon.get_or_insert_with(|| path[..].into());
                    add(path, ico);
                }
                windows.hide_console = true;
                windows.title.get_or_insert_with(|| name.into());
                // What the Task Manager and the taskbar show as the name.
                windows.description.get_or_insert_with(|| name.into());
                let numeric = numeric_version(version);
                let fits =
                    |part| strings::str_utf8(part).is_some_and(|it| it.parse::<u16>().is_ok());
                if strings::split(numeric, b".").all(fits) {
                    windows.version.get_or_insert_with(|| numeric.into());
                }
                if let Some(copyright) = copyright {
                    windows.copyright.get_or_insert_with(|| copyright.into());
                }
            }
            _ => {
                let named = |extension: &[u8]| [&app.identifier, extension].concat();
                let pngs = match &icons.picture {
                    Some(picture) => picture.encode_at(&[16, 24, 32, 48, 64, 128, 256, 512])?,
                    None => Vec::new(),
                };
                let largest = pngs.last().map(|(_, png)| (named(b".png"), png));
                let svg = icons.native.as_ref().map(|svg| (named(b".svg"), svg));
                let top_level_icon = largest.or(svg);
                if let Some((name, bytes)) = &top_level_icon {
                    add(join(&root, &[name]), (*bytes).clone());
                    add(join(&root, &[b".DirIcon"]), (*bytes).clone());
                }
                let entry = desktop_entry(&app, top_level_icon.is_some());
                let share = join(&root, &[b"usr/share"]);
                let installed_entry = join(&share, &[b"applications", &named(b".desktop")]);
                add(installed_entry, entry.clone());
                add(join(&root, &[&named(b".desktop")]), entry);
                let mut add_icon = |folder: &[u8], extension: &[u8], bytes: Vec<u8>| {
                    let parts = [b"icons/hicolor", folder, b"apps", &named(extension)];
                    add(join(&share, &parts), bytes);
                };
                for (size, png) in pngs {
                    add_icon(format!("{size}x{size}").as_bytes(), b".png", png);
                }
                if let Some(svg) = icons.native {
                    add_icon(b"scalable", b".svg", svg);
                }
                if let Some(xml) = mime_info(&app) {
                    add(join(&share, &[b"mime/packages", &named(b".xml")]), xml);
                }
                let name = BStr::new(&app.executable_name);
                // A link starts no shell, but Windows asks for a privilege to make one.
                let app_run = if cfg!(windows) {
                    format!(
                        "#!/bin/sh\nexec \"$(dirname \"$(readlink -f \"$0\")\")/usr/bin/{name}\" \"$@\"\n"
                    )
                } else {
                    format!("usr/bin/{name}")
                };
                files.push(GeneratedFile {
                    path: join(&root, &[b"AppRun"]),
                    bytes: app_run.into_bytes(),
                    is_link: !cfg!(windows),
                });
            }
        }

        let resources = read_resources(&layers, &layout.resources)?;
        for resource in &resources {
            let is_there = |path: &[u8]| path.eq_ignore_ascii_case(&resource.to);
            if files.iter().any(|file| is_there(&file.path)) {
                fail!(
                    "The resource {} would replace {}",
                    quote(&resource.from),
                    quote(bun_paths::basename(&resource.to))
                );
            }
        }
        if bun_sys::exists(&root)
            && !bun_sys::exists(&manifest_path)
            && !has_only_directories(&root)
        {
            fail!(
                "{} already exists and is not a bundle of this app. Remove it, or choose another outfile",
                quote(&shown_path)
            );
        }

        Ok(DesktopBundle {
            shown_path,
            executable,
            root,
            library: layout.library,
            files,
            resources,
        })
    }

    /// For the command line. From here on, the outfile is the executable in the bundle.
    pub(crate) fn plan_or_exit(ctx: &mut ContextData) -> Option<Self> {
        let bundler_options = &mut ctx.bundler_options;
        let request = Request {
            options: bundler_options.desktop.as_deref()?,
            target: &bundler_options.compile_target,
            working_directory: (ctx.args.absolute_working_dir.as_deref())
                .expect("Arguments::parse sets the working directory"),
            entry_point: ctx.args.entry_points.first()?,
            outdir: b"",
            outfile: &bundler_options.outfile,
        };
        match Self::plan(&request, &mut bundler_options.windows) {
            Ok(bundle) => {
                bundler_options.outfile = bundle.executable[..].into();
                Some(bundle)
            }
            Err(error) => {
                bun_core::Output::err_generic("{}", (BStr::new(error.slice()),));
                bun_core::Global::exit(1);
            }
        }
    }

    /// Everything but the executable, which on Windows takes its icon from here.
    pub(crate) fn write(&self, target: &CompileTarget, env: &bun_dotenv::Loader) -> Result<()> {
        let library = library_for(target, env)?;
        for file in &self.files {
            let written = if file.is_link {
                let path = ZBox::from_bytes(&file.path);
                let _ = bun_sys::unlink(&path);
                bun_sys::symlink(&ZBox::from_bytes(&file.bytes), &path)
            } else {
                create(&file.path, 0o644).and_then(|created| created.write_all(&file.bytes))
            };
            written.map_err(|error| not_written(&file.path, &error))?;
        }
        copy_file(&library, &self.library, 0o755)?;
        let real_root = real_path(&self.root).map_err(|error| not_written(&self.root, &error))?;
        for resource in &self.resources {
            copy_tree(&resource.from, &resource.to, &real_root, &mut Vec::new())?;
        }
        Ok(())
    }

    /// Call it when nothing in the bundle changes any more. Returns a warning.
    pub(crate) fn sign(&self, target: &CompileTarget) -> Option<&'static str> {
        if target.os != OperatingSystem::Mac {
            return None;
        }
        const NOT_SIGNED: &str =
            "The .app is not signed as a whole. Run codesign on macOS before you distribute it";
        #[cfg(not(target_os = "macos"))]
        return Some(NOT_SIGNED);
        #[cfg(target_os = "macos")]
        bun_removable_features::call_removable_or!(
            ChildProcess,
            ReturnDefault,
            { Some(NOT_SIGNED) },
            codesign,
            &self.root
        )
    }
}

#[cfg(target_os = "macos")]
#[inline(never)]
fn codesign(bundle: &[u8]) -> Option<&'static str> {
    let arguments: [&[u8]; 6] = [
        b"/usr/bin/codesign",
        b"--force",
        b"--deep",
        b"--sign",
        b"-",
        bundle,
    ];
    let is_signed =
        bun_core::util::spawn_sync_inherit_no_stdin(&arguments).is_ok_and(|status| status.is_ok());
    (!is_signed).then_some("codesign failed, so the .app is not signed as a whole")
}

fn not_written(path: &[u8], error: &bun_sys::Error) -> CompileError {
    CompileError::fmt(format_args!("Failed to write {}: {error}", quote(path)))
}

fn real_path(path: &[u8]) -> bun_sys::Maybe<Vec<u8>> {
    let mut buffer = bun_paths::path_buffer_pool::get();
    bun_sys::realpath(&ZBox::from_bytes(path), &mut buffer).map(<[u8]>::to_vec)
}

/// A new file: the app may be running with the old one mapped, and a link of that name is not followed.
fn create(path: &[u8], mode: bun_sys::Mode) -> bun_sys::Maybe<File> {
    let _ = bun_sys::unlink(&ZBox::from_bytes(path));
    File::make_open(path, O::WRONLY | O::CREAT | O::EXCL | O::CLOEXEC, mode)
}

fn copy_file(from: &[u8], to: &[u8], mode: bun_sys::Mode) -> Result<()> {
    let source = match File::openat(Fd::cwd(), from, O::RDONLY | O::CLOEXEC, 0) {
        Ok(source) => source,
        Err(error) => fail!("Failed to read {}: {error}", quote(from)),
    };
    create(to, mode)
        .and_then(|created| bun_sys::copy_file(source.fd(), created.fd()))
        .map_err(|error| not_written(to, &error))
}

/// Follows links, so that nothing in the bundle leads out of it.
fn copy_tree(
    from: &[u8],
    to: &[u8],
    real_root: &[u8],
    real_ancestors: &mut Vec<Vec<u8>>,
) -> Result<()> {
    let unreadable = |error: bun_sys::Error| {
        CompileError::fmt(format_args!("Failed to read {}: {error}", quote(from)))
    };
    let found = bun_sys::stat(&ZBox::from_bytes(from)).map_err(unreadable)?;
    let mode = found.st_mode as bun_sys::Mode;
    if bun_sys::S::ISREG(mode) {
        return copy_file(from, to, if mode & 0o100 != 0 { 0o755 } else { 0o644 });
    }
    if !bun_sys::S::ISDIR(mode) {
        fail!("The resource {} is no file and no directory", quote(from));
    }
    let real = real_path(from).map_err(unreadable)?;
    if real == real_root {
        return Ok(());
    }
    if real_ancestors.contains(&real) {
        fail!(
            "The resource {} is a link to a directory above it",
            quote(from)
        );
    }
    bun_sys::mkdir_recursive(to).map_err(|error| not_written(to, &error))?;
    let mut names = Vec::new();
    {
        let directory = bun_sys::open_dir_for_iteration(Fd::cwd(), from).map_err(unreadable)?;
        let directory = File::from_fd(directory);
        let mut entries = bun_sys::iterate_dir(directory.fd());
        while let Some(entry) = entries.next().map_err(unreadable)? {
            names.push(entry.name.slice_u8().to_vec());
        }
    }
    real_ancestors.push(real);
    for name in names {
        let (from, to) = (join(from, &[&name]), join(to, &[&name]));
        copy_tree(&from, &to, real_root, real_ancestors)?;
    }
    real_ancestors.pop();
    Ok(())
}
