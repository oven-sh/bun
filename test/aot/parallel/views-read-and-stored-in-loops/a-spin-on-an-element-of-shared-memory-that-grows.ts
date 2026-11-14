// after test/aot/parallel/positions-and-lengths-of-views-in-loops/another-thread-grows-shared-memory-under-a-view.ts: there the read goes into `=== undefined`, here into `| 0`
function wait(view: Int32Array): number {
  let seen = view[0]! | 0;
  for (let turn = 0; turn < 4000000000; turn++) { seen = view[4]! | 0; if (seen !== 0) break; }
  return seen;
}
if (Bun.isMainThread) {
  const shared = new SharedArrayBuffer(8, { maxByteLength: 64 });
  const worker = new Worker(import.meta.url);
  worker.postMessage(shared);
  console.log(wait(new Int32Array(shared)));
  worker.terminate();
} else {
  onmessage = (event: MessageEvent) => {
    const shared = event.data as SharedArrayBuffer;
    shared.grow(24);
    new Int32Array(shared)[4] = 7;
  };
}
