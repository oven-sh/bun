//! `crashReporter`. The directory is laid out as Crashpad's is. A report is uploaded when the app is launched again.

mod minidump;

use core::cell::OnceCell;

use std::rc::Rc;

use bun_deflate::{Format, Level, compress_to_vec};
use bun_jsc::JSString;
use bun_sys::File;
use bun_web::exec::blocking;
use bun_web::headers::HeaderList;
use minidump::{About, Annotations, Target};

use crate::generated_bindgen::electron::{
    CrashReporterOptions, DesktopProcess, ElectronCrashReporter,
};
use crate::prelude::*;
use crate::session::updates::post;
use crate::text::{encode_component, escape, random_bytes, random_uuid};
use crate::value::Value;
use crate::{app, files, modules, paths, process, task, text};

const LONGEST_KEY: usize = 39;
const LONGEST_VALUE: usize = 20320;
const HOUR: i64 = 3600;
/// Not `pending`: libraries that send reports themselves delete what they find there.
const TO_UPLOAD: &str = "queued";

const PLATFORM: [&str; 2] = match () {
    () if IS_MAC => ["darwin", "OS X"],
    () if IS_WINDOWS => ["win32", "Win64"],
    () => ["linux", "Linux"],
};

struct Started {
    directory: String,
    annotations: Annotations,
    kind_of_process: &'static str,
    url: String,
    compresses: bool,
    limits_rate: bool,
}

#[derive(Default)]
struct State {
    parameters: RefCell<Annotations>,
    started: OnceCell<Started>,
    is_uploading: Cell<bool>,
}

state!(fn state() -> State);

/// The first three fields are numbers.
fn uuid(mut bytes: [u8; 16]) -> String {
    for field in [0..4, 4..6, 6..8] {
        bytes[field].reverse();
    }
    let digits = format!("{:032x}", u128::from_be_bytes(bytes));
    [0..8, 8..12, 12..16, 16..20, 20..32]
        .map(|it| &digits[it])
        .join("-")
}

fn random_id() -> [u8; 16] {
    let mut bytes = random_bytes();
    (bytes[7], bytes[8]) = (bytes[7] & 0x0f | 0x40, bytes[8] & 0x3f | 0x80);
    bytes
}

/// `settings.dat`
#[repr(C)]
#[derive(Clone, Copy)]
struct Settings {
    magic: [u8; 4],
    version: u32,
    options: u32,
    padding: u32,
    last_attempt: i64,
    client: [u8; 16],
}

/// The start of `<id>.meta`. What the server has called the report follows.
#[repr(C)]
#[derive(Clone, Copy)]
struct Metadata {
    version: i32,
    attempts: i32,
    last_attempt: i64,
    created: i64,
    attributes: u64,
}

bun_core::impl_pod!(Settings, Metadata);

impl Settings {
    fn path(directory: &str) -> String {
        files::join(&[directory, "settings.dat"])
    }

    fn parse(bytes: &[u8]) -> Option<Settings> {
        bun_core::read_prefix::<Settings>(bytes).filter(|it| it.magic == *b"sdPC")
    }

    fn of(directory: &str) -> Settings {
        let read = files::read(&Self::path(directory));
        read.and_then(|it| Self::parse(&it))
            .unwrap_or_else(|| Settings {
                magic: *b"sdPC",
                version: 1,
                options: 0,
                padding: 0,
                last_attempt: 0,
                client: random_id(),
            })
    }

    /// Without the file nothing is uploaded.
    fn save(&self, directory: &str) {
        let path = Self::path(directory);
        if files::write(&path, bun_core::bytes_of(self), 0o600).is_err() {
            files::remove(&path);
        }
    }

    fn uploads(&self) -> bool {
        self.options & 1 != 0
    }

    fn set_uploads(directory: &str, uploads: bool) {
        let mut settings = Self::of(directory);
        settings.options = settings.options & !1 | u32::from(uploads);
        settings.save(directory);
    }
}

fn publish_parameters() {
    let Some(started) = state().started.get() else {
        return;
    };
    let kind = started.kind_of_process;
    let architecture = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        "arm64"
    };
    let own = [
        ("platform", PLATFORM[0]),
        ("process_type", kind),
        ("ptype", kind),
        ("osarch", architecture),
        ("pid", &*process::id().to_string()),
    ]
    .map(|it| (it.0.into(), it.1.into()));
    let parameters = state().parameters.borrow();
    minidump::set_parameters(own.into_iter().chain(parameters.iter().cloned()).collect());
}

const PLACES: [&str; 3] = ["new", TO_UPLOAD, "completed"];

fn begin(started: Started, file: Option<File>) {
    let started = state().started.get_or_init(|| started);
    let report = random_id();
    let name = format!("{}.dmp", uuid(report));
    let [unfinished, to_upload, to_keep] =
        PLACES.map(|it| files::join(&[&started.directory, it, &name]));
    publish_parameters();
    minidump::prepare(About {
        target: file.map_or_else(
            || {
                Target::Paths([
                    unfinished,
                    to_upload,
                    to_keep,
                    Settings::path(&started.directory),
                ])
            },
            Target::File,
        ),
        report,
        client: Settings::of(&started.directory).client,
        system_version: DesktopProcess::get_system_version(),
        annotations: &started.annotations,
    });
}

pub(crate) fn for_utility_process() -> Value {
    state().started.get().map_or(Value::Null, |it| {
        let annotations = it.annotations.iter().map(|it| list![&*it.0, &*it.1]);
        record! {
            "directory": &*it.directory,
            "annotations": annotations.collect::<Value>(),
        }
    })
}

pub(crate) fn begin_in_utility_process(given: &Value) {
    let Some(directory) = given["directory"].as_text() else {
        return;
    };
    let annotations = given["annotations"].items().iter();
    let started = Started {
        directory: directory.into(),
        annotations: (annotations.map(|it| (it[0].text().into(), it[1].text().into()))).collect(),
        kind_of_process: "utility",
        url: String::new(),
        compresses: false,
        limits_rate: false,
    };
    begin(started, None);
}

#[cfg(target_os = "linux")]
fn file_without_name(_: &str) -> Option<File> {
    use bun_sys::{MemfdFlags, ftruncate, memfd_create};
    let file = File::from_fd(memfd_create(c"report".into(), MemfdFlags::NonExecutable).ok()?);
    ftruncate(file.fd(), minidump::LARGEST as i64).ok()?;
    // SAFETY: it only takes numbers.
    let status = unsafe { libc::fcntl(file.fd().native(), libc::F_ADD_SEALS, libc::F_SEAL_GROW) };
    (status == 0).then_some(file)
}

#[cfg(not(target_os = "linux"))]
fn file_without_name(directory: &str) -> Option<File> {
    use bun_sys::O;
    let path = files::join(&[directory, "new", &random_uuid()]);
    let how = O::RDWR | O::CREAT | O::EXCL | O::CLOEXEC;
    let file = File::openat(bun_sys::Fd::cwd(), path.as_bytes(), how, 0o600).ok()?;
    files::remove(&path);
    Some(file)
}

pub(crate) fn file_for_page_process() -> Option<[File; 2]> {
    let file = file_without_name(&state().started.get()?.directory)?;
    Some([File::from_fd(bun_sys::dup(file.fd()).ok()?), file])
}

pub(crate) fn begin_in_page_process(file: File) {
    let started = Started {
        directory: String::new(),
        annotations: Vec::new(),
        kind_of_process: "renderer",
        url: String::new(),
        compresses: false,
        limits_rate: false,
    };
    begin(started, Some(file));
}

/// Once the page process has ended.
pub(crate) async fn keep_report_in(file: File, site: Rc<str>) {
    const MOST: usize = 64;
    const MOST_FOR_SITE: usize = 4;
    state!(fn kept() -> RefCell<Vec<Rc<str>>>);
    let mut start = [0; 4];
    let has_room = |all: &[Rc<str>]| {
        all.len() < MOST && all.iter().filter(|it| **it == site).count() < MOST_FOR_SITE
    };
    let Some(started) = state().started.get() else {
        return;
    };
    if file.pread_all(&mut start, 0).is_err() || start == [0; 4] || !has_room(&kept().borrow()) {
        return;
    }
    kept().borrow_mut().push(site);
    let keep = move || {
        let size = bun_sys::get_file_size(file.fd()).ok()?;
        let mut dump = vec![0; (size as usize).min(minidump::LARGEST)];
        file.pread_all(&mut dump, 0).ok()?;
        let (settings, report) = (Settings::of(&started.directory), random_id());
        let dump = minidump::complete(dump, report, settings.client, &started.annotations)?;
        let name = format!("{}.dmp", uuid(report));
        let [unfinished, to_upload, to_keep] =
            PLACES.map(|it| files::join(&[&started.directory, it, &name]));
        files::write(&unfinished, &dump, 0o600).ok()?;
        let target = if settings.uploads() {
            to_upload
        } else {
            to_keep
        };
        files::rename(&unfinished, &target).ok()
    };
    blocking(keep).await;
}

/// Their paths without the extension.
fn reports_in(directory: &str, place: &str) -> Vec<String> {
    let directory = files::join(&[directory, place]);
    let names = files::names_in(&directory);
    let ids = names.iter().filter_map(|it| it.strip_suffix(".dmp"));
    ids.map(|it| files::join(&[&directory, it])).collect()
}

/// To a year and 128 MB.
fn prune(directory: &str) {
    let with_facts = |path: String| {
        let dump = bun_core::ZBox::from_bytes(format!("{path}.dmp").as_bytes());
        let facts = bun_sys::stat(&dump).ok()?;
        Some((bun_sys::stat_mtime(&facts).sec, facts.st_size as u64, path))
    };
    let all = [TO_UPLOAD, "completed"].map(|it| reports_in(directory, it));
    let mut all: std::collections::BinaryHeap<_> =
        all.into_iter().flatten().filter_map(with_facts).collect();
    let (oldest, mut total) = (bun_core::time::timestamp() - 365 * 24 * HOUR, 0);
    while let Some((time, size, path)) = all.pop() {
        total += size;
        if time < oldest || total > 128 << 20 {
            files::remove(&format!("{path}.dmp"));
        }
    }
    let unfinished = reports_in(directory, "new")
        .into_iter()
        .filter_map(with_facts);
    for (.., path) in unfinished.filter(|it| it.0 < oldest + 364 * 24 * HOUR) {
        files::remove(&format!("{path}.dmp"));
    }
    let completed = files::join(&[directory, "completed"]);
    for name in files::names_in(&completed) {
        let path = files::join(&[&completed, &name]);
        if (path.strip_suffix(".meta")).is_some_and(|it| !files::exists(&format!("{it}.dmp"))) {
            files::remove(&path);
        }
    }
}

struct Upload {
    query: String,
    headers: HeaderList,
    body: Vec<u8>,
}

fn pack(report: &str, compresses: bool) -> Option<Upload> {
    let dump = files::read(&format!("{report}.dmp"))?;
    let (client, mut fields) = minidump::annotations(&dump)?;
    let (client, boundary) = (
        uuid(client),
        format!("---MultipartBoundary-{}---", random_uuid()),
    );
    fields.retain(|it| it.0 != b"guid" && it.0 != b"upload_file_minidump");
    fields.push((b"guid", client.as_bytes()));
    let quote = |it: &str| {
        escape(it, |it| match it {
            '\r' => Some("%0d"),
            '\n' => Some("%0a"),
            '"' => Some("%22"),
            '%' => Some("%25"),
            _ => None,
        })
    };
    let mut body = Vec::new();
    let mut add = |about: String, contents: &[u8]| {
        let head = format!("--{boundary}\r\nContent-Disposition: form-data; {about}\r\n\r\n");
        body.extend([head.as_bytes(), contents, b"\r\n"].concat());
    };
    for (name, value) in &fields {
        add(format!("name=\"{}\"", quote(&string(name))), value);
    }
    let name = quote(files::name(report));
    add(
        format!(
            "name=\"upload_file_minidump\"; filename=\"{name}.dmp\"\r\nContent-Type: application/octet-stream"
        ),
        &dump,
    );
    body.extend(format!("--{boundary}--\r\n").bytes());

    let mut headers = HeaderList::default();
    let kind = format!("multipart/form-data; boundary={boundary}");
    headers.set(b"Content-Type", kind.as_bytes());
    if compresses {
        headers.set(b"Content-Encoding", b"gzip");
        body = compress_to_vec(&body, Format::Gzip, Level::DEFAULT).ok()?;
    }
    let query = [("prod", "product"), ("ver", "version"), ("guid", "guid")].map(|(field, name)| {
        let value = fields.iter().find(|it| it.0 == field.as_bytes());
        format!(
            "{name}={}",
            encode_component(&string(value.map_or(b"", |it| it.1)))
        )
    });
    Some(Upload {
        query: query.join("&"),
        headers,
        body,
    })
}

/// What the server calls it.
async fn upload(started: &'static Started, report: String) -> Option<Vec<u8>> {
    let compresses = started.compresses;
    let it = blocking(move || pack(&report, compresses)).await??;
    let separator = if text::contains(&started.url, "?") {
        '&'
    } else {
        '?'
    };
    let url = format!("{}{separator}{}", started.url, it.query);
    if !Settings::of(&started.directory).uploads() {
        return None;
    }
    let (status, mut id) = post(&url, it.headers, it.body).await.ok()?;
    id.truncate(1024);
    (200..=203).contains(&status).then_some(id)
}

async fn upload_pending(started: &'static Started) {
    let directory = &*started.directory;
    let _ = task::settled(app::ready()).await;
    let find = blocking(move || {
        prune(directory);
        reports_in(directory, TO_UPLOAD)
    });
    for report in find.await.unwrap_or_default() {
        let (mut settings, now) = (Settings::of(directory), bun_core::time::timestamp());
        if started.url.is_empty() || !settings.uploads() {
            break;
        }
        let kept = files::join(&[directory, "completed", files::name(&report)]);
        if !started.limits_rate || !(0..HOUR).contains(&(now - settings.last_attempt)) {
            settings.last_attempt = now;
            settings.save(directory);
            let id = upload(started, report.clone()).await;
            let metadata = Metadata {
                version: 1,
                attempts: 1,
                last_attempt: now,
                created: now,
                attributes: id.is_some().into(),
            };
            let all = [bun_core::bytes_of(&metadata), &id.unwrap_or_default()].concat();
            let _ = files::write(&format!("{kept}.meta"), &all, 0o600);
        }
        let _ = files::rename(&format!("{report}.dmp"), &format!("{kept}.dmp"));
        files::remove(&format!("{report}.meta"));
    }
    state().is_uploading.set(false);
}

fn upload_soon() {
    if let Some(started) = state().started.get()
        && !crate::utility::is_this_process()
        && !state().is_uploading.replace(true)
    {
        task::spawn(upload_pending(started));
    }
}

/// When each was uploaded, and what the server calls it.
fn reports() -> Vec<(i64, String)> {
    let Some(started) = state().started.get() else {
        return Vec::new();
    };
    let about = |report: String| {
        let all = files::read(&format!("{report}.meta"))?;
        let metadata = bun_core::read_prefix::<Metadata>(&all)?;
        let id = string(&all[size_of::<Metadata>()..]);
        (metadata.attributes & 1 != 0).then_some((metadata.last_attempt, id))
    };
    let all = ["completed", "pending", TO_UPLOAD].map(|it| reports_in(&started.directory, it));
    (all.into_iter().flatten())
        .map(|it| about(it).unwrap_or_default())
        .collect()
}

fn report_to_js((time, id): (i64, String)) -> JsResult<JSValue> {
    let date = JSValue::from_date_number(global(), time as f64 * 1000.);
    Ok(object!({ "date": date, "id": id }))
}

fn set(all: &mut Annotations, key: &str, value: &str) {
    all.retain(|it| it.0 != key);
    let value = &value[..value.floor_char_boundary(LONGEST_VALUE)];
    all.push((key.into(), value.into()));
}

pub(crate) fn put_parameters(into: JSValue) -> JsResult<()> {
    for (key, value) in &*state().parameters.borrow() {
        let key = bun_core::String::clone_utf8(key.as_bytes());
        into.put_may_be_index(global(), &key, js(&**value)?)?;
    }
    Ok(())
}

impl ElectronCrashReporter {
    pub(crate) fn start<'a>(_: Cx<'a, '_>, options: &CrashReporterOptions<'a>) -> JsResult<()> {
        let text = |it: JsLocal<'a, JSString>| text_of(it.to_js());
        let url = string(options.submit_url.unwrap_or_default());
        let uploads = options.upload_to_server.unwrap_or(true);
        let compresses = options.compress.unwrap_or(true);
        if uploads && url.is_empty() {
            return Err(error(format_args!(
                "submitURL must be specified when uploadToServer is true"
            )));
        }
        if uploads && !compresses {
            warn(
                "Sending uncompressed crash reports is deprecated and will be removed in a future version of Electron. Set { compress: true } to opt-in to the new behavior. Crash reports will be uploaded gzipped, which most crash reporting servers support.",
            )?;
        }
        if state().started.get().is_some() {
            return Ok(());
        }
        let product = options.product_name.map(string);
        let mut annotations = vec![
            (
                "_productName".into(),
                product.map_or_else(paths::app_name, Ok)?,
            ),
            ("_version".into(), paths::manifest()?.version.clone()),
        ];
        if let Some(company) = options.company_name.filter(|it| !it.is_empty()) {
            annotations.push(("_companyName".into(), string(company)));
        }
        for (key, value) in options.global_extra.iter().flat_map(|it| it.iter()) {
            set(&mut annotations, &text(key)?, &text(value)?);
        }
        for (key, value) in [
            ("prod", "Electron"),
            ("ver", modules::ELECTRON),
            ("plat", PLATFORM[1]),
            ("bun", bun_core::Global::package_json_version_with_sha),
        ] {
            set(&mut annotations, key, value);
        }
        for (key, value) in options.extra.iter().flat_map(|it| it.iter()) {
            Self::add_extra_parameter(text(key)?.as_bytes(), text(value)?.as_bytes());
        }
        let directory = files::absolute(&paths::path("crashDumps")?);
        for place in PLACES {
            let _ = files::make_directory(&files::join(&[&directory, place]), 0o700);
        }
        Settings::set_uploads(&directory, uploads);
        let started = Started {
            directory,
            annotations,
            kind_of_process: "browser",
            url,
            compresses,
            limits_rate: options.rate_limit,
        };
        begin(started, None);
        upload_soon();
        crate::contents::process::statics_changed()
    }

    pub(crate) fn add_extra_parameter(key: &[u8], value: &[u8]) {
        if key.len() <= LONGEST_KEY {
            set(
                &mut state().parameters.borrow_mut(),
                &string(key),
                &string(value),
            );
            publish_parameters();
        }
    }

    pub(crate) fn remove_extra_parameter(key: &[u8]) {
        (state().parameters.borrow_mut()).retain(|it| it.0.as_bytes() != key);
        publish_parameters();
    }

    pub(crate) fn get_parameters(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let all = object!({});
        put_parameters(all).map(|()| all)
    }

    pub(crate) fn get_last_crash_report(_: Cx<'_, '_>) -> JsResult<JSValue> {
        (reports().into_iter().max()).map_or(Ok(JSValue::NULL), report_to_js)
    }

    pub(crate) fn get_uploaded_reports(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let all = array(&[])?;
        for it in reports() {
            all.push(global(), report_to_js(it)?)?;
        }
        Ok(all)
    }

    pub(crate) fn get_upload_to_server() -> bool {
        (state().started.get()).is_some_and(|it| Settings::of(&it.directory).uploads())
    }

    pub(crate) fn set_upload_to_server(uploads: bool) {
        if let Some(started) = state().started.get() {
            Settings::set_uploads(&started.directory, uploads);
            upload_soon();
        }
    }
}
