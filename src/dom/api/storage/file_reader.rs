//! <https://w3c.github.io/FileAPI/#reading-data-section>

use bun_jsc::webcore_types::Blob as JsBlob;
use bun_jsc::{ArrayBuffer, JSObject};
use bun_web::convert::{blob_from_js, unreadable};
use bun_web::encoding::Encoding;
use bun_web::mime::Mime;
use bun_web::net::NetError;
use bun_web::net::body::{Blob, Data, SharedBytes};

use super::*;
use crate::api::events::swap_top_level;
use crate::api::realm::Kept;

#[repr(C)]
pub(crate) struct ProgressEvent {
    pub(crate) base: Event,
    is_length_computable: bool,
    loaded: f64,
    total: f64,
}

impl ProgressEvent {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        name: Known,
        loaded: u64,
        total: Option<u64>,
    ) -> &'a ProgressEvent {
        let base = Event::base(name, EventInit::default(), Trusted::Yes);
        js_ProgressEvent::create(
            heap,
            ProgressEvent {
                base,
                is_length_computable: total.is_some(),
                loaded: loaded as f64,
                total: total.unwrap_or(0) as f64,
            },
        )
    }

    pub(crate) fn constructor(name: Atom, init: &ProgressEventInit) -> ProgressEvent {
        let base = Event::base(
            name,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        ProgressEvent {
            base,
            is_length_computable: init.length_computable,
            loaded: init.loaded,
            total: init.total,
        }
    }

    pub(crate) fn get_length_computable(&self) -> bool {
        self.is_length_computable
    }

    pub(crate) fn get_loaded(&self) -> f64 {
        self.loaded
    }

    pub(crate) fn get_total(&self) -> f64 {
        self.total
    }
}

#[derive(Clone, Copy)]
enum As {
    ArrayBuffer,
    BinaryString,
    Text(Option<Encoding>),
    DataUrl,
}

pub(crate) fn blob_of(blob: JSValue) -> Option<Blob> {
    blob_from_js(&*blob.as_class_ref::<JsBlob>()?)
}

pub(crate) async fn read(data: Data) -> core::result::Result<SharedBytes, NetError> {
    match data {
        Data::Bytes(bytes) => Ok(bytes),
        data => Ok(data.open().read_to_end().await?.into_shared()),
    }
}

/// <https://w3c.github.io/FileAPI/#blob-package-data>
fn package<'a>(heap: &JsHeap<'a>, bytes: &[u8], how: As, mime: &[u8]) -> Result<'a, JSValue> {
    Ok(match how {
        As::ArrayBuffer => {
            ArrayBuffer::create::<{ bun_jsc::JSType::ArrayBuffer }>(global_of(heap), bytes)?
        }
        As::BinaryString => heap.try_create_latin1_string(bytes)?.to_js(),
        As::Text(encoding) => {
            let encoding = encoding
                .or_else(|| Encoding::for_label(Mime::parse(mime)?.parameter(b"charset")?))
                .unwrap_or_default();
            heap.create_utf8_string(encoding.decode(bytes, false).as_bytes())?
                .to_js()
        }
        As::DataUrl => {
            let mut url = [
                &b"data:"[..],
                if mime.is_empty() {
                    b"application/octet-stream"
                } else {
                    mime
                },
                b";base64,",
            ]
            .concat();
            bun_base64::encode_append(&mut url, bytes);
            heap.try_create_latin1_string(&url)?.to_js()
        }
    })
}

const LOADING: u16 = 1;
const DONE: u16 = 2;

#[repr(C)]
#[derive(Default)]
pub(crate) struct FileReader {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_DomFileReader::Fields,
    state: Cell<u16>,
    /// The tasks of an earlier one do nothing.
    operation: Cell<u32>,
}

impl FileReader {
    pub(crate) fn constructor() -> FileReader {
        FileReader::default()
    }

    pub(crate) fn get_ready_state(&self) -> u16 {
        self.state.get()
    }

    fn fire<'a>(&'a self, cx: Cx<'_, 'a>, name: Known, loaded: u64, total: u64) {
        if self.has_listeners(name) {
            dispatch(
                cx,
                self,
                ProgressEvent::new(&cx.heap, name, loaded, Some(total)),
            );
        }
    }

    fn end<'a>(&'a self, cx: Cx<'_, 'a>, name: Known, size: u64) {
        self.state.set(DONE);
        self.fire(cx, name, size, size);
        if self.state.get() != LOADING {
            self.fire(cx, atom!("loadend"), size, size);
        }
    }

    /// <https://w3c.github.io/FileAPI/#readOperation>
    fn read<'a>(&'a self, cx: Cx<'_, 'a>, blob: JsLocal<'a, JSObject>, how: As) -> Result<'a> {
        if self.state.replace(LOADING) == LOADING {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "The object is already busy reading Blobs.",
            ));
        }
        js_DomFileReader::set_result(self, JSValue::NULL);
        js_DomFileReader::set_error(self, JSValue::NULL);
        let (kept, blob, operation) = (
            Kept::new(cx, self.to_js()),
            blob_of(blob.to_js()),
            self.operation.get() + 1,
        );
        self.operation.set(operation);
        spawn(&cx.heap, async move {
            let (size, mime) = blob
                .as_ref()
                .map_or_else(Default::default, |it| (it.data.len(), it.mime.clone()));
            let bytes = if let Some(blob) = blob {
                read(blob.data).await
            } else {
                Err(NetError::Failed)
            };
            let step = |steps: Box<dyn for<'b> FnOnce(Cx<'_, 'b>, &'b FileReader)>| {
                kept.queue_task(move |cx, this| {
                    FileReader::from_js(&cx.heap, this.to_js())
                        .filter(|it| it.operation.get() == operation)
                        .map_or((), |it| steps(cx, it))
                });
            };
            step(Box::new(move |cx, this| {
                this.fire(cx, atom!("loadstart"), 0, size)
            }));
            if bytes.is_ok() && size > 0 {
                step(Box::new(move |cx, this| {
                    this.fire(cx, atom!("progress"), size, size)
                }));
            }
            step(Box::new(move |cx, this| {
                match bytes
                    .map_err(|it| unreadable(&cx.heap, it))
                    .and_then(|it| package(&cx.heap, &it, how, &mime))
                {
                    Ok(result) => {
                        js_DomFileReader::set_result(this, result);
                        this.end(cx, atom!("load"), size);
                    }
                    Err(error) => {
                        let Ok(error) = cx.catch(error) else { return };
                        js_DomFileReader::set_error(this, error);
                        this.end(cx, atom!("error"), size);
                    }
                }
            }));
        });
        Ok(())
    }

    pub(crate) fn read_as_array_buffer<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        blob: JsLocal<'a, JSObject>,
    ) -> Result<'a> {
        self.read(cx, blob, As::ArrayBuffer)
    }

    pub(crate) fn read_as_binary_string<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        blob: JsLocal<'a, JSObject>,
    ) -> Result<'a> {
        self.read(cx, blob, As::BinaryString)
    }

    pub(crate) fn read_as_text<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        blob: JsLocal<'a, JSObject>,
        encoding: Option<&[u8]>,
    ) -> Result<'a> {
        self.read(cx, blob, As::Text(encoding.and_then(Encoding::for_label)))
    }

    pub(crate) fn read_as_data_url<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        blob: JsLocal<'a, JSObject>,
    ) -> Result<'a> {
        self.read(cx, blob, As::DataUrl)
    }

    pub(crate) fn abort<'a>(&'a self, cx: Cx<'_, 'a>) {
        js_DomFileReader::set_result(self, JSValue::NULL);
        if self.state.get() == LOADING {
            self.operation.update(|it| it + 1);
            js_DomFileReader::set_error(
                self,
                cx.heap
                    .create_dom_exception(
                        DomError::AbortError,
                        format_args!("The read was aborted."),
                    )
                    .to_js(),
            );
            let was_at_top_level = swap_top_level(false);
            self.end(cx, atom!("abort"), 0);
            swap_top_level(was_at_top_level);
        }
    }
}

fn read_now<'a>(cx: Cx<'_, 'a>, blob: JsLocal<'a, JSObject>, how: As) -> Result<'a, JSValue> {
    let Blob { data, mime } =
        blob_of(blob.to_js()).ok_or_else(|| unreadable(&cx.heap, NetError::Failed))?;
    package(
        &cx.heap,
        &data.read_now().map_err(|it| unreadable(&cx.heap, it))?,
        how,
        &mime,
    )
}

impl FileReaderSync {
    pub(crate) fn constructor() -> FileReaderSync {
        FileReaderSync::default()
    }

    pub(crate) fn read_as_array_buffer<'a>(
        &self,
        cx: Cx<'_, 'a>,
        blob: JsLocal<'a, JSObject>,
    ) -> Result<'a, JSValue> {
        read_now(cx, blob, As::ArrayBuffer)
    }

    pub(crate) fn read_as_binary_string<'a>(
        &self,
        cx: Cx<'_, 'a>,
        blob: JsLocal<'a, JSObject>,
    ) -> Result<'a, JSValue> {
        read_now(cx, blob, As::BinaryString)
    }

    pub(crate) fn read_as_text<'a>(
        &self,
        cx: Cx<'_, 'a>,
        blob: JsLocal<'a, JSObject>,
        encoding: Option<&[u8]>,
    ) -> Result<'a, JSValue> {
        read_now(cx, blob, As::Text(encoding.and_then(Encoding::for_label)))
    }

    pub(crate) fn read_as_data_url<'a>(
        &self,
        cx: Cx<'_, 'a>,
        blob: JsLocal<'a, JSObject>,
    ) -> Result<'a, JSValue> {
        read_now(cx, blob, As::DataUrl)
    }
}
