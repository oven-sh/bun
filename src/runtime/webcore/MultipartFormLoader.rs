//! Streams a `multipart/form-data` body for `fetch()` so `Bun.file()` parts
//! are read in chunks instead of buffered whole.

use bun_jsc::JSValue;
use bun_sys::{self as sys, Fd, FdExt as _};

use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::{self, StoreRef};
use crate::webcore::node_types::PathOrFileDescriptor;
use crate::webcore::readable_stream;
use crate::webcore::streams;

pub type Source = readable_stream::NewSource<MultipartFormLoader>;

const CHUNK_SIZE: blob::SizeType = 256 * 1024;

pub enum Segment {
    Bytes {
        bytes: Vec<u8>,
        offset: usize,
    },
    File {
        store: StoreRef,
        /// Absolute `pread` offset; starts at the Blob's `offset`.
        pos: u64,
        remain: u64,
        /// Opened lazily on first pull; closed when drained or on cancel.
        fd: Fd,
    },
}

impl Segment {
    fn close(&mut self) {
        if let Segment::File { fd, .. } = self
            && *fd != Fd::INVALID
        {
            core::mem::replace(fd, Fd::INVALID).close();
        }
    }
}

#[derive(Default)]
pub struct MultipartFormLoader {
    pub segments: Vec<Segment>,
    pub idx: usize,
    pub done: bool,
}

impl readable_stream::SourceContext for MultipartFormLoader {
    const NAME: &'static str = "MultipartForm";
    const SUPPORTS_REF: bool = false;
    crate::source_context_codegen!(js_MultipartFormInternalReadableStreamSource);

    fn on_start(&mut self) -> streams::Start {
        streams::Start::ChunkSize(CHUNK_SIZE)
    }

    fn on_pull(&mut self, buffer: &mut [u8], array: JSValue) -> streams::Result {
        array.ensure_still_alive();
        let _keep = bun_jsc::EnsureStillAlive(array);
        if self.done {
            return streams::Result::Done;
        }

        let mut written = 0usize;
        while written < buffer.len() {
            let Some(seg) = self.segments.get_mut(self.idx) else {
                break;
            };
            match seg {
                Segment::Bytes { bytes, offset } => {
                    let src = &bytes[*offset..];
                    let take = src.len().min(buffer.len() - written);
                    buffer[written..written + take].copy_from_slice(&src[..take]);
                    *offset += take;
                    written += take;
                    if *offset >= bytes.len() {
                        *bytes = Vec::new();
                        self.idx += 1;
                    }
                }
                Segment::File {
                    store,
                    pos,
                    remain,
                    fd,
                } => {
                    if *remain == 0 {
                        seg.close();
                        self.idx += 1;
                        continue;
                    }
                    if *fd == Fd::INVALID {
                        match Self::open(store) {
                            Ok(opened) => *fd = opened,
                            Err(err) => {
                                self.clear_data();
                                return streams::Result::Err(streams::result::StreamError::Error(
                                    err,
                                ));
                            }
                        }
                    }
                    let want = ((buffer.len() - written) as u64).min(*remain) as usize;
                    match sys::pread(*fd, &mut buffer[written..written + want], *pos as i64) {
                        Err(err) => {
                            self.clear_data();
                            return streams::Result::Err(streams::result::StreamError::Error(err));
                        }
                        Ok(0) => {
                            // File shrank after Content-Length went on the wire:
                            // abort rather than underrun the promised length.
                            let err = sys::Error::new(bun_errno::SystemErrno::EIO, sys::Tag::pread)
                                .with_fd(*fd);
                            self.clear_data();
                            return streams::Result::Err(streams::result::StreamError::Error(err));
                        }
                        Ok(n) => {
                            written += n;
                            *pos += n as u64;
                            *remain = remain.saturating_sub(n as u64);
                        }
                    }
                    if *remain == 0 {
                        seg.close();
                        self.idx += 1;
                    }
                }
            }
        }

        if self.idx >= self.segments.len() {
            self.done = true;
            self.segments = Vec::new();
            if written == 0 {
                return streams::Result::Done;
            }
            return streams::Result::IntoArrayAndDone(streams::IntoArray {
                value: array,
                len: written as blob::SizeType,
            });
        }

        streams::Result::IntoArray(streams::IntoArray {
            value: array,
            len: written as blob::SizeType,
        })
    }

    fn on_cancel(&mut self) {
        self.clear_data();
    }

    fn deinit_fn(&mut self) {
        self.clear_data();
    }

    fn memory_cost_fn(&self) -> usize {
        self.segments
            .iter()
            .map(|s| match s {
                Segment::Bytes { bytes, .. } => bytes.len(),
                Segment::File { .. } => 0,
            })
            .sum::<usize>()
            + self.segments.len() * core::mem::size_of::<Segment>()
    }
}

bun_core::impl_field_parent! { MultipartFormLoader => Source.context; pub fn parent_const; pub fn parent; }

impl MultipartFormLoader {
    fn open(store: &StoreRef) -> sys::Result<Fd> {
        let file = store.data_mut().as_file();
        match &file.pathlike {
            PathOrFileDescriptor::Fd(fd) => sys::dup(*fd),
            PathOrFileDescriptor::Path(path) => {
                let mut buf = bun_paths::PathBuffer::uninit();
                let zpath = path.slice_z(&mut buf);
                let flags = if cfg!(windows) {
                    sys::O::RDONLY
                } else {
                    sys::O::RDONLY | sys::O::NOCTTY
                };
                sys::open(zpath, flags, 0)
            }
        }
    }

    fn clear_data(&mut self) {
        self.done = true;
        for seg in self.segments.iter_mut() {
            seg.close();
        }
        self.segments = Vec::new();
    }
}
