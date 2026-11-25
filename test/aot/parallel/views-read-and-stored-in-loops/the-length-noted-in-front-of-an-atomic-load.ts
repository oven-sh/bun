let first = 0, kept = 0;
function watch(view: Int32Array, flags: Int32Array): number {
  let seen = view[0]! | 0, ready = flags[0]! | 0, early = 0, work = 0;
  Atomics.store(flags, 1, 1);
  while (ready === 0) {
    early = view[4]! | 0;
    work = 0;
    for (let k = 0; k < 300000; k++) work = (work + k) | 0;
    ready = Atomics.load(flags, 0);
    seen = view[4]! | 0;
  }
  first = early; kept = work;
  return seen;
}
if (Bun.isMainThread) {
  const shared = new SharedArrayBuffer(8, { maxByteLength: 64 });
  const signal = new SharedArrayBuffer(8);
  const worker = new Worker(import.meta.url);
  worker.postMessage({ shared, signal });
  console.log(watch(new Int32Array(shared), new Int32Array(signal)), first | 7, kept);
  worker.terminate();
} else {
  onmessage = (event: MessageEvent) => {
    const { shared, signal } = event.data as { shared: SharedArrayBuffer; signal: SharedArrayBuffer };
    const flags = new Int32Array(signal);
    while (Atomics.load(flags, 1) === 0);
    shared.grow(24);
    new Int32Array(shared)[4] = 7;
    Atomics.store(flags, 0, 1);
  };
}
