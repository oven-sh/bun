//! `bun:internal-for-testing`: the wrappers of `bun_highway::jpeg`, with rows of lengths the codec never gives them.

use bun_highway::jpeg;
use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal};

type Answer<'a> = bindgen::Result<'a, JsLocal<'a, BufferSource>>;

const UNWRITTEN: u8 = 0xa5;

fn pairs(length: u16) -> Vec<[u8; 2]> {
    vec![[UNWRITTEN; 2]; usize::from(length)]
}

fn answer<'a>(heap: &JsHeap<'a>, done: bool, rows: &[&[u8]]) -> Answer<'a> {
    let mut bytes = vec![u8::from(done)];
    rows.iter().for_each(|row| bytes.extend_from_slice(row));
    heap.create_uint8_array(&bytes)
}

pub(crate) fn from_ycc<'a>(
    heap: &JsHeap<'a>,
    y: &[u8],
    cb: &[u8],
    cr: &[u8],
    k: Option<&[u8]>,
    before: u16,
    room: u16,
) -> Answer<'a> {
    // `Vec::with_capacity` may give more room than it is asked for. A boxed slice has none to spare.
    let all = vec![[UNWRITTEN; 4]; usize::from(before) + usize::from(room)];
    let mut out = all.into_boxed_slice().into_vec();
    out.truncate(usize::from(before));
    let done = jpeg::from_ycc(y, cb, cr, k, &mut out);
    answer(heap, done, &[out.as_flattened()])
}

pub(crate) fn to_ycc<'a>(heap: &JsHeap<'a>, rgba: &[u8], y: u16, cb: u16, cr: u16) -> Answer<'a> {
    let [mut y, mut cb, mut cr] = [y, cb, cr].map(|length| vec![UNWRITTEN; usize::from(length)]);
    let done = jpeg::to_ycc(rgba.as_chunks().0, &mut y, &mut cb, &mut cr);
    answer(heap, done, &[&y, &cb, &cr])
}

pub(crate) fn h2v2_downsample<'a>(
    heap: &JsHeap<'a>,
    row0: &[u8],
    row1: &[u8],
    out: u16,
) -> Answer<'a> {
    let mut out = pairs(out);
    let done = jpeg::h2v2_downsample(row0.as_chunks().0, row1.as_chunks().0, &mut out);
    answer(heap, done, &[out.as_flattened()])
}

pub(crate) fn h2v1_fancy<'a>(heap: &JsHeap<'a>, input: &[u8], out: u16) -> Answer<'a> {
    let mut out = pairs(out);
    let done = jpeg::h2v1_fancy(input, &mut out);
    answer(heap, done, &[out.as_flattened()])
}

pub(crate) fn h2v2_fancy<'a>(heap: &JsHeap<'a>, near: &[u8], far: &[u8], out: u16) -> Answer<'a> {
    let mut out = pairs(out);
    let done = jpeg::h2v2_fancy(near, far, &mut out);
    answer(heap, done, &[out.as_flattened()])
}
