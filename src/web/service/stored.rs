//! What outlasts the program. The scripts are read when they are needed.

use bun_collections::index_sort::sort_slice_by_key;
use bun_core::ZBox;
use bun_sys::{Fd, File, O};

use super::registry::{Contents, Registration, Scripts, Worker};
use super::*;
use crate::headers::HeaderList;
use crate::net::body::Chunk;
use crate::net::record::{RecordReader, RecordWriter};
use crate::net::response::Head;

const FORMAT: &[u8] = b"service workers 3";

fn file_of(session: &Session) -> Option<Vec<u8>> {
    Some([session.directory()?, b"/Service Workers"].concat())
}

fn shared(bytes: &[u8]) -> SharedBytes {
    Chunk::Owned(bytes.to_vec()).into_shared()
}

pub(super) fn read_scripts(of: &Url, bytes: &[u8]) -> Option<Scripts> {
    let it = &mut RecordReader(bytes);
    (it.bytes()? == of.href()).then_some(())?;
    let (source, headers) = (it.optional()?.map(shared), HeaderList::read(it)?);
    let loaded = it.list(|it| {
        let (url, kind) = (Url::parse(it.bytes()?)?, ResponseType::parse(it.bytes()?)?);
        let head = Head::new(kind, Url::parse(it.bytes()?)?, HeaderList::read(it)?);
        let bytes = shared(it.bytes()?);
        Some((url, Loaded { head, bytes }))
    })?;
    let imports = Imports {
        loaded,
        is_complete: true,
        ..Imports::default()
    };
    Some(Scripts {
        source,
        headers,
        imports: Arc::new(Guarded::new(imports)),
    })
}

pub(super) fn write_scripts(of: &Url, scripts: &Scripts) -> Vec<u8> {
    let mut out = RecordWriter::default();
    out.bytes(of.href());
    out.optional(scripts.source.as_deref());
    scripts.headers.write(&mut out);
    let imports = scripts.imports.lock();
    out.count(imports.loaded.len());
    for (url, Loaded { head, bytes }) in &imports.loaded {
        out.bytes(url.href());
        out.bytes(head.kind.as_bytes());
        out.bytes(head.url.href());
        head.headers.write(&mut out);
        out.bytes(bytes);
    }
    out.0
}

pub(super) fn write_routes(routes: &[Rule], out: &mut RecordWriter) {
    out.count(routes.len());
    routes.iter().for_each(|it| it.write(out));
}

fn read_worker(it: &mut RecordReader<'_>, state: State, registration: Id) -> Option<Worker> {
    let (url, flags, row) = (Url::parse(it.bytes()?)?, it.count()?, it.number()?);
    let before = it.0.len();
    Some(Worker {
        is_module: flags & 1 != 0,
        handles_fetch: flags & 2 != 0,
        is_compiled: flags & 4 != 0,
        row: Some(row as i64),
        routes: it.list(Rule::read)?,
        size_of_routes: before - it.0.len(),
        ..Worker::new(url, state, registration)
    })
}

#[optimize(size)]
pub(super) fn read(session: &Session) -> Option<Contents> {
    let bytes = File::read_from(Fd::cwd(), &file_of(session)?).ok()?;
    let mut contents = Contents::default();
    contents.registrations = RecordReader(bytes.strip_prefix(FORMAT)?).list(|it| {
        let mut registration = Registration {
            id: ClientId::next().0,
            bucket: it.bytes()?.into(),
            ancestors: it.list(|it| Some(Origin::from_serialized(it.bytes()?)))?,
            scope: Url::parse(it.bytes()?)?,
            update_via_cache: UpdateViaCache::parse(it.bytes()?)?,
            workers: [None; 3],
            checked_at: it.number()?,
            preload: (it.count()? == 1, it.bytes()?.into()),
            subscriptions: it.list(|it| {
                let name = it.optional()?.map(Into::into);
                let url = Url::parse(it.bytes()?)?;
                Some(Subscription { name, url })
            })?,
            is_unregistered: false,
            is_update_due: false,
        };
        for (slot, state) in [(WAITING, State::Installed), (ACTIVE, State::Activated)] {
            if it.count()? == 1 {
                let worker = read_worker(it, state, registration.id)?;
                registration.workers[slot] = Some(worker.info.id);
                contents.rows.push(worker.row?);
                contents.workers.insert(worker.info.id, worker);
            }
        }
        Some(registration)
    })?;
    Some(contents)
}

#[optimize(size)]
pub(super) fn write(session: &Session, contents: &mut Contents) {
    let is_kept = |it: &&Registration| {
        !it.is_unregistered && (it.workers[WAITING].is_some() || it.workers[ACTIVE].is_some())
    };
    let mut out = RecordWriter(FORMAT.to_vec());
    out.count(contents.registrations.iter().filter(is_kept).count());
    for it in contents.registrations.iter().filter(is_kept) {
        out.bytes(&it.bucket);
        out.count(it.ancestors.len());
        it.ancestors.iter().for_each(|it| out.bytes(it.as_bytes()));
        out.bytes(it.scope.href());
        out.bytes(it.update_via_cache.as_bytes());
        out.number(it.checked_at);
        out.count(it.preload.0.into());
        out.bytes(&it.preload.1);
        out.count(it.subscriptions.len());
        for it in &it.subscriptions {
            out.optional(it.name.as_deref());
            out.bytes(it.url.href());
        }
        for slot in [WAITING, ACTIVE] {
            let worker = it.workers[slot].and_then(|it| contents.workers.get(&it));
            out.count(worker.is_some().into());
            let Some(worker) = worker else { continue };
            out.bytes(worker.info.url.href());
            out.count(
                usize::from(worker.is_module)
                    + 2 * usize::from(worker.handles_fetch)
                    + 4 * usize::from(worker.is_compiled),
            );
            out.number(worker.row.unwrap_or_default() as f64);
            write_routes(&worker.routes, &mut out);
        }
    }
    let needed = (contents.workers.values()).filter(|it| it.info.state != State::Redundant);
    let mut rows = Vec::from_iter(needed.filter_map(|it| it.row));
    sort_slice_by_key(&mut rows, |it| *it);
    let unused = (contents.rows).extract_if(.., |it| rows.binary_search(it).is_err());
    let (unused, file) = (unused.collect(), file_of(session));
    session.storage.delete_scripts(unused, move || {
        let Some(file) = file else { return Some(()) };
        let suffix = format!("~{}", std::process::id());
        let partial = ZBox::from_bytes([&file, suffix.as_bytes()].concat());
        let how = O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC;
        File::open(&partial, how, 0o600)
            .ok()?
            .write_all(&out.0)
            .ok()?;
        bun_sys::rename(&partial, &ZBox::from_bytes(file)).ok()
    });
}
