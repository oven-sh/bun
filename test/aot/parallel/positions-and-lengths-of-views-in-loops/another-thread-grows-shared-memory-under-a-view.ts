// No turn of either loop does anything to the view: another thread lengthens the memory that it follows, and the loop ends when it sees that.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function wait(view: Int32Array): number {
  let turns = 0;
  while (view[4] === undefined) turns++;
  return turns >= 0 ? view[4]! : -1;
}
function waitForLength(view: Int32Array): number {
  let turns = 0;
  while (view.length < 9) turns++;
  return turns >= 0 ? view.length : -1;
}
if (Bun.isMainThread) {
  const shared = new SharedArrayBuffer(8, { maxByteLength: 64 });
  const view = new Int32Array(shared);
  const worker = new Worker(import.meta.url);
  worker.postMessage(shared);
  console.log(wait(view));
  Atomics.store(view, 0, 1);
  console.log(waitForLength(view));
  worker.terminate();
} else {
  onmessage = (event: MessageEvent) => {
    const shared = event.data as SharedArrayBuffer;
    shared.grow(24);
    const view = new Int32Array(shared);
    while (Atomics.load(view, 0) === 0);
    shared.grow(40);
  };
}
