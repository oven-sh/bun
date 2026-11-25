// Guards: toResizableBuffer() counts among what grows shared memory. This program names no grow() and takes in no library module that does: the instruction memory.grow in the worker is all that grows the memory.
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 2, 9, 1, 1, 97, 1, 109, 2, 3, 1, 40, 3, 2, 1, 0, 7, 5, 1, 1, 103, 0, 0, 10, 8, 1, 6, 0, 65, 1, 64, 0, 11]);
function spin(view: Uint8Array): string { const was = view.length; let turns = 0; while (view.length === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (view.length > was); }
function sumWhileItGrows(view: Uint8Array): string { const was = view.length; let total = 0, i = 0; for (; i < view.length && i < 3e9; i++) { total += view[i & 1023] + 1; if (i === was - 1) { const end = Date.now() + 400; while (Date.now() < end); } } return (i > was) + " " + (total === i); }
if (Bun.isMainThread) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 40, shared: true });
  const view = new Uint8Array((memory as any).toResizableBuffer());
  const worker = new Worker(new URL(import.meta.url));
  worker.postMessage(memory);
  console.log(spin(view)); console.log(spin(view)); console.log(sumWhileItGrows(view));
  worker.terminate();
} else {
  (globalThis as any).onmessage = (event: MessageEvent) => {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { a: { m: event.data } });
    setInterval(() => (instance.exports.g as () => number)(), 100);
  };
}
