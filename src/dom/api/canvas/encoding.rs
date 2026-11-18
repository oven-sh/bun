//! https://html.spec.whatwg.org/#serialising-bitmaps-to-a-file

use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::job::{Completion, Job, JobContext, JsThread};
use bun_jsc::webcore_types::{Blob, BlobContentType};
use bun_jsc::{GlobalRef, JSPromise, JSPromiseStrong, JSValue, JsClass as _, JsResult};

use super::bitmap::Unencoded;

pub(super) fn data_url(pixels: Option<Unencoded>) -> Vec<u8> {
    let Some((mime_type, bytes)) = pixels.and_then(|it| Some((it.mime_type(), it.encode()?)))
    else {
        return b"data:,".into();
    };
    let mut url = [b"data:", mime_type, b";base64,"].concat();
    bun_base64::encode_append(&mut url, &bytes);
    url
}

struct Encode {
    pixels: Option<Unencoded>,
    file: Option<(&'static [u8], Vec<u8>)>,
}

impl JobContext for Encode {
    type OffThread = Encode;
    type Js = (JSPromiseStrong, GlobalRef);

    fn run(job: &mut Encode, done: Completion<Self>) -> Option<Completion<Self>> {
        job.file = job
            .pixels
            .take()
            .and_then(|it| Some((it.mime_type(), it.encode()?)));
        Some(done)
    }

    fn then(job: Encode, (mut promise, global): Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        let Some((mime_type, bytes)) = job.file else {
            return promise.resolve(&global, JSValue::NULL);
        };
        let blob = Blob::init(bytes, &global);
        blob.content_type.set(BlobContentType::Static(mime_type));
        blob.content_type_was_set.set(true);
        promise.resolve(&global, blob.to_js(&global))
    }
}

/// A promise for a `Blob`, or for null.
pub(super) fn encode_in_parallel<'a>(
    cx: &mut JsScope<'a>,
    pixels: Option<Unencoded>,
) -> JsLocal<'a, JSPromise> {
    let (promise, global) = (
        JSPromiseStrong::init(cx.global()),
        GlobalRef::new(cx.global()),
    );
    let value = JsLocal::new(&cx.heap, promise.value())
        .as_promise()
        .expect("just made");
    Job::<Encode>::schedule(
        &cx.js_thread(),
        Encode { pixels, file: None },
        (promise, global),
    );
    value
}
