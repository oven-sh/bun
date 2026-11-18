//! What a page process has been given.

use std::sync::LazyLock;

use bun_collections::{HashMap, StringSet};
use bun_core::ZBox;
use bun_sys::{E, Error, Fd, File, O, PosixStat, S, Tag};
use bun_threading::Guarded;

use super::petition::{self, Opened};
use super::{HOST, Peer, is_page_process};
use crate::storage::Shelf;
use crate::wire::{self, Malformed, Reader, Wire, Writer};

#[derive(Default)]
struct Given {
    files: StringSet,
    shelves: Vec<Shelf>,
}

static GIVEN: LazyLock<Guarded<HashMap<Peer, Given>>> = LazyLock::new(Default::default);

pub(super) fn begin(peer: Peer) {
    GIVEN.lock().insert(peer, Given::default());
}

pub fn grant(to: Peer, path: &[u8]) {
    if let Some(given) = GIVEN.lock().get_mut(&to) {
        bun_core::handle_oom(given.files.insert(path));
    }
}

pub fn is_granted(to: Peer, path: &[u8]) -> bool {
    to == HOST || (GIVEN.lock().get(&to)).is_some_and(|it| it.files.contains(path))
}

pub fn revoke_files(of: Peer) {
    if let Some(given) = GIVEN.lock().get_mut(&of) {
        given.files = StringSet::default();
    }
}

pub(super) fn has_shelf(peer: Peer, shelf: &Shelf) -> bool {
    (GIVEN.lock().get(&peer)).is_some_and(|it| it.shelves.contains(shelf))
}

pub(super) fn forget(peer: Peer) {
    GIVEN.lock().remove(&peer);
}

/// Who is sent this by the host may use it.
pub(crate) struct Access(pub(crate) Option<Shelf>);

impl Wire for Access {
    fn write(self, to: &mut Writer) {
        if let Some((peer, shelf)) = to.peer().zip(self.0)
            && let Some(given) = GIVEN.lock().get_mut(&peer)
            && !given.shelves.contains(&shelf)
        {
            given.shelves.push(shelf);
        }
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Access> {
        match from.peer() {
            None | Some(HOST) => Ok(Access(None)),
            Some(_) => Err(Malformed),
        }
    }
}

/// For reading. A page process gets those that it has been given.
pub fn open_file(path: &[u8]) -> bun_sys::Result<File> {
    if !is_page_process() {
        return File::openat(Fd::cwd(), path, O::RDONLY | O::CLOEXEC, 0);
    }
    match petition::open_file(path.into()) {
        Some((Opened::File, Some(file))) => Ok(file),
        Some((Opened::Failed { errno }, _)) => Err(Error::from_code_int(errno, Tag::open)),
        _ => Err(Error::from_code(E::EISDIR, Tag::open)),
    }
}

/// In milliseconds. `None` if it is no directory.
pub fn modification_of_directory(path: &[u8]) -> Option<f64> {
    if is_page_process() {
        return match petition::open_file(path.into())?.0 {
            Opened::Directory { modified } => Some(modified),
            _ => None,
        };
    }
    let stat = bun_sys::stat(&ZBox::from_bytes(path)).ok()?;
    S::ISDIR(stat.st_mode as _).then(|| PosixStat::init(&stat).mtime().ms() as f64)
}
