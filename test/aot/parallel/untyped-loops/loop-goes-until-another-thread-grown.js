// A loop over the elements of a view that tracks the length of a shared buffer ends only when it sees the length that another thread has given the buffer.
const given = JSON.parse('{"chunks":[]}');
function hide(value) {
  given.chunks[0] = value;
  return given.chunks[0];
}
function untilLongerThan(view, length) {
  let s = 0;
  for (let i = 0; view.length <= length; i++) s = (s + view[i & 1]) | 0;
  return s * 0 + view.length;
}
if (Bun.isMainThread) {
  for (const Kind of [Uint8Array, Int32Array, Float64Array]) {
    const shared = new SharedArrayBuffer(2 * Kind.BYTES_PER_ELEMENT, { maxByteLength: 16 * Kind.BYTES_PER_ELEMENT });
    const worker = new Worker(new URL(import.meta.url));
    worker.postMessage([shared, 5 * Kind.BYTES_PER_ELEMENT]);
    console.log(Kind.name, untilLongerThan(hide(new Kind(shared)), 2));
    worker.terminate();
  }
} else addEventListener("message", event => event.data[0].grow(event.data[1]));
