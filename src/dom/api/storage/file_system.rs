//! <https://fs.spec.whatwg.org/>

use std::collections::VecDeque;

use bun_jsc::bindgen::{BufferSource, to_js};
use bun_jsc::{JSGlobalObject, call_zero_is_throw};
use bun_web::exec::LocalFuture;
use bun_web::held::Held;
use bun_web::storage::files::{self, Draft, FileError, LockMode, OpenFile, is_valid_name};

use super::file_reader::blob_of;
use super::*;

unsafe extern "C" {
    safe fn Bun__Desktop__createFileStream(
        global: &JSGlobalObject,
        prototype: JSValue,
        sink: JSValue,
        write: JSValue,
        close: JSValue,
        abort: JSValue,
    ) -> JSValue;
    safe fn Bun__Desktop__writeToStream(
        global: &JSGlobalObject,
        stream: JSValue,
        chunk: JSValue,
    ) -> JSValue;
}

fn error_of<'a>(cx: Cx<'_, 'a>, error: FileError) -> Error<'a> {
    let (code, message) = match error {
        FileError::NotFound => (
            DomError::NotFoundError,
            "A requested file or directory could not be found.",
        ),
        FileError::TypeMismatch => (
            DomError::TypeMismatchError,
            "The entry is not of the expected type.",
        ),
        FileError::Locked => (
            DomError::NoModificationAllowedError,
            "The file or directory is locked.",
        ),
        FileError::NotEmpty => (
            DomError::InvalidModificationError,
            "The directory is not empty.",
        ),
        FileError::IsDirectory => (
            DomError::InvalidModificationError,
            "There is a directory of that name.",
        ),
        FileError::QuotaExceeded => {
            return quota_exceeded(cx, "The operation would exceed the storage quota.");
        }
        FileError::Failed => (DomError::InvalidStateError, "The operation failed."),
    };
    dom_error(&cx.heap, code, message)
}

pub(super) fn promise_for_file<'a, T: 'static>(
    cx: Cx<'_, 'a>,
    future: impl Future<Output = files::Result<T>> + 'static,
    convert: impl for<'b> FnOnce(Cx<'_, 'b>, T) -> Result<'b, JSValue> + 'static,
) -> JSValue {
    promise_for(cx, future, |cx, result| match result {
        Ok(value) => convert(cx, value),
        Err(error) => Err(error_of(cx, error)),
    })
}

fn promise_for_end(
    cx: Cx<'_, '_>,
    future: impl Future<Output = files::Result> + 'static,
) -> JSValue {
    promise_for_file(cx, future, |_, ()| Ok(JSValue::UNDEFINED))
}

fn child_of<'a>(heap: &JsHeap<'a>, directory: &Locator, name: &[u8]) -> Result<'a, Locator> {
    if is_valid_name(name) {
        Ok(directory.child(name))
    } else {
        Err(heap.type_error(format_args!("Name is not allowed.")))
    }
}

pub(crate) struct FileSystemHandle {
    kind: Kind,
    locator: Rc<RefCell<Locator>>,
    _interior: bun_jsc::bindgen::Interior,
}

impl FileSystemHandle {
    pub(super) fn new<'a>(heap: &JsHeap<'a>, kind: Kind, locator: Locator) -> &'a FileSystemHandle {
        let made = FileSystemHandle {
            kind,
            locator: Rc::new(locator.into()),
            _interior: Default::default(),
        };
        if kind == Kind::File {
            js_FileSystemFileHandle::create(heap, made)
        } else {
            js_FileSystemDirectoryHandle::create(heap, made)
        }
    }

    fn clone_out<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let locator = self.locator.borrow();
        let mut parts = vec![locator.bucket()];
        parts.extend(locator.names.iter().map(|it| &**it));
        Ok(to_js::array(&cx.heap, parts, to_js::utf8)?.to_js())
    }

    fn clone_in<'a>(cx: Cx<'_, 'a>, kind: Kind, clone: JsLocal<'a>) -> Result<'a, JSValue> {
        let (mut parts, mut items) = (
            Vec::<Box<[u8]>>::new(),
            clone.to_js().array_iterator(cx.global())?,
        );
        while let Some(item) = items.next()? {
            parts.push(item.to_utf8(items.global)?.slice().into());
        }
        if let ([bucket, names @ ..], Some(client)) = (&parts[..], client_of(&cx.heap))
            && (**bucket == *client.bucket()
                && cx.heap.is_secure_context()
                && names.iter().all(|it| is_valid_name(it)))
        {
            return Ok(FileSystemHandle::new(
                &cx.heap,
                kind,
                Locator::new(Arc::clone(&client.session.storage), bucket, names.to_vec()),
            )
            .to_js());
        }
        Err(dom_error(
            &cx.heap,
            DomError::DataCloneError,
            "A handle cannot go to another origin.",
        ))
    }

    pub(crate) fn get_kind(&self) -> FileSystemHandleKind {
        if self.kind == Kind::File {
            FileSystemHandleKind::File
        } else {
            FileSystemHandleKind::Directory
        }
    }

    pub(crate) fn get_name(&self) -> Vec<u8> {
        self.locator
            .borrow()
            .names
            .last()
            .map(|it| it.to_vec())
            .unwrap_or_default()
    }

    pub(crate) fn is_same_entry<'a>(
        &self,
        cx: Cx<'_, 'a>,
        other: &'a FileSystemHandle,
    ) -> Result<'a, JSValue> {
        Ok(cx
            .promise_resolve(
                (self.kind == other.kind
                    && self.locator.borrow().names == other.locator.borrow().names)
                    .into(),
            )?
            .to_js())
    }

    pub(crate) fn query_permission<'a>(
        &self,
        cx: Cx<'_, 'a>,
        _: &FileSystemPermissionDescriptor,
    ) -> Result<'a, JSValue> {
        let granted = cx.heap.create_latin1_string(b"granted").to_js();
        Ok(cx.promise_resolve(granted)?.to_js())
    }

    pub(crate) fn remove<'a>(
        &self,
        cx: Cx<'_, 'a>,
        options: &FileSystemRemoveOptions,
    ) -> Result<'a, JSValue> {
        Ok(promise_for_end(
            cx,
            self.locator.borrow().remove(options.recursive),
        ))
    }
}

impl FileSystemFileHandle {
    pub(crate) fn serialize<'a>(&self, cx: Cx<'_, 'a>, _: bool) -> Result<'a, JSValue> {
        self.clone_out(cx)
    }

    pub(crate) fn deserialize<'a>(cx: Cx<'_, 'a>, clone: JsLocal<'a>) -> Result<'a, JSValue> {
        FileSystemHandle::clone_in(cx, Kind::File, clone)
    }

    pub(crate) fn get_file<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let name = self.get_name();
        Ok(promise_for_file(
            cx,
            self.locator.borrow().snapshot(),
            move |cx, (path, stat)| {
                Ok(bun_web::runtime::create_snapshot(
                    cx.global(),
                    path,
                    &stat,
                    &name,
                ))
            },
        ))
    }

    pub(crate) fn create_writable<'a>(
        &self,
        cx: Cx<'_, 'a>,
        options: &FileSystemCreateWritableOptions,
    ) -> Result<'a, JSValue> {
        let mode = options.mode;
        let lock_mode = if mode == FileSystemWritableMode::Siloed {
            LockMode::Siloed
        } else {
            LockMode::Exclusive
        };
        Ok(promise_for_file(
            cx,
            self.locator
                .borrow()
                .draft(lock_mode, options.keep_existing_data),
            move |cx, draft| FileSystemWritableFileStream::new(cx, draft, mode),
        ))
    }

    pub(crate) fn create_sync_access_handle<'a>(
        &self,
        cx: Cx<'_, 'a>,
        options: &FileSystemSyncAccessOptions,
    ) -> Result<'a, JSValue> {
        let mode = options.mode;
        let lock_mode = match mode {
            FileSystemSyncAccessMode::Readwrite => LockMode::Exclusive,
            FileSystemSyncAccessMode::ReadOnly => LockMode::ReadOnly,
            FileSystemSyncAccessMode::ReadwriteUnsafe => LockMode::Unsafe,
        };
        Ok(promise_for_file(
            cx,
            self.locator.borrow().open(lock_mode),
            move |cx, file| {
                let made = FileSystemSyncAccessHandle {
                    file: realm_of(&cx.heap).hold(file),
                    mode,
                    position: 0.into(),
                };
                Ok(js_FileSystemSyncAccessHandle::create(&cx.heap, made).to_js())
            },
        ))
    }

    fn move_into<'a>(
        &self,
        cx: Cx<'_, 'a>,
        directory: &Locator,
        name: &[u8],
    ) -> Result<'a, JSValue> {
        let (target, locator) = (
            child_of(&cx.heap, directory, name)?,
            Rc::clone(&self.locator),
        );
        Ok(promise_for_file(
            cx,
            self.locator.borrow().move_file(target.clone()),
            move |_, ()| {
                locator.replace(target);
                Ok(JSValue::UNDEFINED)
            },
        ))
    }

    pub(crate) fn rename<'a>(&self, cx: Cx<'_, 'a>, name: &[u8]) -> Result<'a, JSValue> {
        self.move_into(cx, &self.locator.borrow().parent(), name)
    }

    pub(crate) fn move_to<'a>(
        &self,
        cx: Cx<'_, 'a>,
        directory: &'a FileSystemDirectoryHandle,
    ) -> Result<'a, JSValue> {
        self.move_into(cx, &directory.locator.borrow(), &self.get_name())
    }

    pub(crate) fn move_and_rename<'a>(
        &self,
        cx: Cx<'_, 'a>,
        directory: &'a FileSystemDirectoryHandle,
        name: &[u8],
    ) -> Result<'a, JSValue> {
        self.move_into(cx, &directory.locator.borrow(), name)
    }
}

impl FileSystemDirectoryHandle {
    pub(crate) fn serialize<'a>(&self, cx: Cx<'_, 'a>, _: bool) -> Result<'a, JSValue> {
        self.clone_out(cx)
    }

    pub(crate) fn deserialize<'a>(cx: Cx<'_, 'a>, clone: JsLocal<'a>) -> Result<'a, JSValue> {
        FileSystemHandle::clone_in(cx, Kind::Directory, clone)
    }

    fn get_handle<'a>(
        &self,
        cx: Cx<'_, 'a>,
        kind: Kind,
        name: &[u8],
        options: &FileSystemGetOptions,
    ) -> Result<'a, JSValue> {
        let child = child_of(&cx.heap, &self.locator.borrow(), name)?;
        Ok(promise_for_file(
            cx,
            child.find(kind, options.create),
            move |cx, ()| Ok(FileSystemHandle::new(&cx.heap, kind, child).to_js()),
        ))
    }

    pub(crate) fn get_file_handle<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: &[u8],
        options: &FileSystemGetOptions,
    ) -> Result<'a, JSValue> {
        self.get_handle(cx, Kind::File, name, options)
    }

    pub(crate) fn get_directory_handle<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: &[u8],
        options: &FileSystemGetOptions,
    ) -> Result<'a, JSValue> {
        self.get_handle(cx, Kind::Directory, name, options)
    }

    pub(crate) fn remove_entry<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: &[u8],
        options: &FileSystemRemoveOptions,
    ) -> Result<'a, JSValue> {
        let child = child_of(&cx.heap, &self.locator.borrow(), name)?;
        Ok(promise_for_end(cx, child.remove(options.recursive)))
    }

    pub(crate) fn resolve<'a>(
        &self,
        cx: Cx<'_, 'a>,
        descendant: &'a FileSystemHandle,
    ) -> Result<'a, JSValue> {
        let path = match descendant
            .locator
            .borrow()
            .names
            .strip_prefix(&*self.locator.borrow().names)
        {
            Some(names) => to_js::array(&cx.heap, names, to_js::utf8)?.to_js(),
            None => JSValue::NULL,
        };
        Ok(cx.promise_resolve(path)?.to_js())
    }

    fn iterate<'a>(&self, heap: &JsHeap<'a>, yields: Yields) -> &'a FileSystemDirectoryIterator {
        js_FileSystemDirectoryIterator::create(
            heap,
            FileSystemDirectoryIterator {
                directory: self.locator.borrow().clone(),
                yields,
                left: Rc::default(),
            },
        )
    }

    pub(crate) fn entries<'a>(&self, heap: &JsHeap<'a>) -> &'a FileSystemDirectoryIterator {
        self.iterate(heap, Yields::Both)
    }

    pub(crate) fn keys<'a>(&self, heap: &JsHeap<'a>) -> &'a FileSystemDirectoryIterator {
        self.iterate(heap, Yields::Name)
    }

    pub(crate) fn values<'a>(&self, heap: &JsHeap<'a>) -> &'a FileSystemDirectoryIterator {
        self.iterate(heap, Yields::Handle)
    }
}

#[derive(Clone, Copy)]
enum Yields {
    Name,
    Handle,
    Both,
}

pub(crate) struct FileSystemDirectoryIterator {
    directory: Locator,
    yields: Yields,
    /// Once it has been read.
    left: Rc<RefCell<Option<VecDeque<(Box<[u8]>, Kind)>>>>,
}

impl FileSystemDirectoryIterator {
    pub(crate) fn next<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let (directory, yields, left) =
            (self.directory.clone(), self.yields, Rc::clone(&self.left));
        let children = left.borrow().is_none().then(|| directory.children());
        let read = async {
            if let Some(children) = children {
                children.await
            } else {
                Ok(Vec::new())
            }
        };
        Ok(promise_for_file(cx, read, move |cx, children| {
            let Some((name, kind)) = left
                .borrow_mut()
                .get_or_insert_with(|| children.into())
                .pop_front()
            else {
                return Ok(cx.heap.create_iterator_result(None).to_js());
            };
            let (key, handle) = (to_js::utf8(&cx.heap, &name)?, || {
                FileSystemHandle::new(&cx.heap, kind, directory.child(&name)).to_js()
            });
            let value = match yields {
                Yields::Name => key.to_js(),
                Yields::Handle => handle(),
                Yields::Both => to_js::array(
                    &cx.heap,
                    [key, JsLocal::new(&cx.heap, handle())],
                    |_, it| Ok(it),
                )?
                .to_js(),
            };
            Ok(cx.heap.create_iterator_result(Some(value)).to_js())
        }))
    }
}

pub(crate) struct FileSystemWritableFileStream {
    draft: Held<Draft>,
    mode: FileSystemWritableMode,
    _interior: bun_jsc::bindgen::Interior,
}

fn write_data<'a>(
    cx: Cx<'_, 'a>,
    draft: Draft,
    data: JsLocal<'a>,
    at: Option<u64>,
) -> Result<'a, LocalFuture<'static, files::Result>> {
    if let Some(blob) = blob_of(data.to_js()) {
        return Ok(Box::pin(async move {
            let (mut body, mut at) = (blob.data.open(), at);
            while let Some(part) = body.read().await.map_err(|_| FileError::NotFound)? {
                draft.write(part, at.take()).await?;
            }
            if at.is_some() {
                draft.write(Vec::new(), at).await
            } else {
                Ok(())
            }
        }));
    }
    let bytes = match data.as_buffer_source() {
        Some(buffer) => buffer.with_bytes(&cx.heap, <[u8]>::to_vec),
        None => DomString::from_js(cx, data)?
            .to_utf8()
            .into_owned()
            .into_bytes(),
    };
    Ok(Box::pin(draft.write(bytes, at)))
}

/// <https://fs.spec.whatwg.org/#write-a-chunk>
fn write_chunk<'a>(
    cx: Cx<'_, 'a>,
    draft: Draft,
    chunk: JsLocal<'a>,
) -> Result<'a, LocalFuture<'static, files::Result>> {
    let value = chunk.to_js();
    if if value.is_object() {
        blob_of(value).is_some() || chunk.as_buffer_source().is_some()
    } else {
        !value.is_undefined_or_null()
    } {
        return write_data(cx, draft, chunk, None);
    }
    let (kind, position, size, data) = WriteParams::from_js(cx.global(), value, |it| {
        Ok((it.r#type, it.position, it.size, it.data.to_js()))
    })?;
    match (kind, position, size) {
        (WriteCommandType::Seek, Some(position), _) => Ok(Box::pin(draft.seek(position))),
        (WriteCommandType::Truncate, _, Some(size)) => Ok(Box::pin(draft.truncate(size))),
        (WriteCommandType::Write, ..) if data.is_null() => Err(cx
            .heap
            .type_error(format_args!("write requires data that is not null."))),
        (WriteCommandType::Write, at, _) if !data.is_undefined() => {
            write_data(cx, draft, JsLocal::new(&cx.heap, data), at)
        }
        _ => Err(dom_error(
            &cx.heap,
            DomError::SyntaxError,
            "The command lacks an argument.",
        )),
    }
}

impl FileSystemWritableFileStream {
    fn new<'a>(cx: Cx<'_, 'a>, draft: Draft, mode: FileSystemWritableMode) -> Result<'a, JSValue> {
        const WRITE: u64 = 0;
        const CLOSE: u64 = 1;
        const ABORT: u64 = 2;
        fn run<'a>(
            cx: Cx<'_, 'a>,
            [sink, _]: [JsLocal<'a>; 2],
            algorithm: u64,
            arguments: &[JsLocal<'a>],
        ) -> Result<'a, JSValue> {
            let Some(held) = FileSystemWritableFileStream::from_js(&cx.heap, sink.to_js())
                .map(|it| Rc::clone(&it.draft))
            else {
                return Ok(JSValue::UNDEFINED);
            };
            let Some(draft) = held.take() else {
                return Ok(JSValue::UNDEFINED);
            };
            match algorithm {
                WRITE => {
                    let written = write_chunk(cx, draft.clone(), arguments[0])?;
                    held.replace(Some(draft));
                    Ok(promise_for_end(cx, async move {
                        written.await.inspect_err(|_| drop(held.take()))
                    }))
                }
                CLOSE => Ok(promise_for_end(cx, draft.keep())),
                _ => Ok(JSValue::UNDEFINED),
            }
        }
        let sink = js_FileSystemWritableFileStream::create(
            &cx.heap,
            FileSystemWritableFileStream {
                draft: hold(&cx.heap, draft),
                mode,
                _interior: Default::default(),
            },
        );
        let [write, close, abort] = [WRITE, CLOSE, ABORT].map(|it| {
            cx.heap
                .create_callback(run, [sink.to_js(), JSValue::UNDEFINED], it)
                .to_js()
        });
        let (prototype, global) = (
            js_FileSystemWritableFileStream::CLASS.prototype(&cx.heap),
            cx.global(),
        );
        let stream = call_zero_is_throw(global, || {
            Bun__Desktop__createFileStream(global, prototype, sink.to_js(), write, close, abort)
        })?;
        js_FileSystemWritableFileStream::set_stream(sink, stream);
        Ok(stream)
    }

    pub(crate) fn get_mode(&self) -> FileSystemWritableMode {
        self.mode
    }

    pub(crate) fn write<'a>(&self, cx: Cx<'_, 'a>, data: JsLocal<'a>) -> Result<'a, JSValue> {
        let (stream, global) = (
            js_FileSystemWritableFileStream::stream(self).expect("a stream"),
            cx.global(),
        );
        Ok(call_zero_is_throw(global, || {
            Bun__Desktop__writeToStream(global, stream, data.to_js())
        })?)
    }

    fn send<'a>(
        &self,
        cx: Cx<'_, 'a>,
        kind: &[u8],
        argument: &'static str,
        value: u64,
    ) -> Result<'a, JSValue> {
        let command = Object::new(cx);
        command.latin1(cx, "type", kind);
        command.number(cx, argument, value as f64);
        self.write(cx, command.into_value())
    }

    pub(crate) fn seek<'a>(&self, cx: Cx<'_, 'a>, position: u64) -> Result<'a, JSValue> {
        self.send(cx, b"seek", "position", position)
    }

    pub(crate) fn truncate<'a>(&self, cx: Cx<'_, 'a>, size: u64) -> Result<'a, JSValue> {
        self.send(cx, b"truncate", "size", size)
    }
}

pub(crate) struct FileSystemSyncAccessHandle {
    file: Held<OpenFile>,
    mode: FileSystemSyncAccessMode,
    position: Cell<u64>,
}

impl FileSystemSyncAccessHandle {
    fn with_file<'a, R>(
        &self,
        cx: Cx<'_, 'a>,
        writes: bool,
        steps: impl FnOnce(&JsHeap<'a>, &OpenFile) -> files::Result<R>,
    ) -> Result<'a, R> {
        let result = match &*self.file.borrow() {
            None => {
                return Err(dom_error(
                    &cx.heap,
                    DomError::InvalidStateError,
                    "The access handle was already closed.",
                ));
            }
            Some(_) if writes && self.mode == FileSystemSyncAccessMode::ReadOnly => {
                Err(FileError::Locked)
            }
            Some(file) => steps(&cx.heap, file),
        };
        result.map_err(|it| error_of(cx, it))
    }

    pub(crate) fn get_mode(&self) -> FileSystemSyncAccessMode {
        self.mode
    }

    pub(crate) fn read<'a>(
        &self,
        cx: Cx<'_, 'a>,
        buffer: JsLocal<'a, BufferSource>,
        options: &FileSystemReadWriteOptions,
    ) -> Result<'a, u64> {
        let (position, mut target) = (
            options.at.unwrap_or_else(|| self.position.get()),
            buffer
                .to_js()
                .as_array_buffer(cx.global())
                .unwrap_or_default(),
        );
        self.with_file(cx, false, |_, file| {
            let count = file.read(target.byte_slice_mut(), position)? as u64;
            self.position.set(if count > 0 {
                position + count
            } else {
                position.min(file.size()?)
            });
            Ok(count)
        })
    }

    pub(crate) fn write<'a>(
        &self,
        cx: Cx<'_, 'a>,
        buffer: JsLocal<'a, BufferSource>,
        options: &FileSystemReadWriteOptions,
    ) -> Result<'a, u64> {
        let position = options.at.unwrap_or_else(|| self.position.get());
        let count = self.with_file(cx, true, |heap, file| {
            buffer.with_bytes(heap, |it| {
                file.write(it, position).map(|()| it.len() as u64)
            })
        })?;
        self.position.set(position + count);
        Ok(count)
    }

    pub(crate) fn truncate<'a>(&self, cx: Cx<'_, 'a>, size: u64) -> Result<'a> {
        self.with_file(cx, true, |_, file| file.truncate(size))
            .map(|()| self.position.update(|it| it.min(size)))
    }

    pub(crate) fn get_size<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, u64> {
        self.with_file(cx, false, |_, file| file.size())
    }

    pub(crate) fn flush<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a> {
        self.with_file(cx, true, |_, file| file.flush())
    }

    pub(crate) fn close(&self) {
        self.file.take();
    }
}
