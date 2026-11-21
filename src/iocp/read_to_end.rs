use core::cell::Cell;
use std::os::windows::io::OwnedHandle;
use std::rc::Rc;

use bun_windows_sys::{NT_ERROR, Win32Error};

use crate::{AsyncFile, Completion, Handle, Port, Request};

struct Reader {
    file: AsyncFile,
    read: Cell<Option<Request>>,
    contents: Cell<Vec<u8>>,
}

impl Reader {
    fn read(self: &Rc<Self>, mut contents: Vec<u8>) {
        contents.reserve(64 * 1024);
        let this = Rc::clone(self);
        let done = move |completion: Completion| match NT_ERROR(completion.status) {
            true => this.contents.set(completion.buffer),
            false => this.read(completion.buffer),
        };
        match self.file.read(contents, usize::MAX, done) {
            Ok(read) => self.read.set(Some(read)),
            Err(refused) => self.contents.set(refused.buffer),
        }
    }
}

/// Returns once the other ends of `pipes` are closed. They are as for [`AsyncFile::exclusive`].
pub fn read_to_end<const N: usize>(
    pipes: [Option<OwnedHandle>; N],
) -> Result<[Vec<u8>; N], Win32Error> {
    if pipes.iter().all(Option::is_none) {
        return Ok([const { Vec::new() }; N]);
    }
    let port = Port::new()?;
    let readers = pipes.map(|pipe| {
        let handle = Handle::from_owned(pipe?);
        let reader = Rc::new(Reader {
            file: AsyncFile::exclusive(&port, handle),
            read: Cell::new(None),
            contents: Cell::default(),
        });
        reader.read(Vec::new());
        Some(reader)
    });
    while port.callback_count() > 0 {
        port.wait(None);
        port.dispatch(|_| {});
    }
    Ok(readers.map(|reader| reader.map_or_default(|reader| reader.contents.take())))
}
