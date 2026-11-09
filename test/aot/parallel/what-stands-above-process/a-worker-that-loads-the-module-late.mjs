// A Worker has a `process` and a chain of its own. What it loads links nothing in the realm that started it.
if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  const said = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
  console.log("worker", said);
  await worker.terminate();
  console.log("main", Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype);
} else {
  const native = Object.getPrototypeOf(process);
  const before = Object.getPrototypeOf(native) === Object.prototype;
  const { EventEmitter } = await import("node:events");
  postMessage([before, Object.getPrototypeOf(native) === EventEmitter.prototype, process instanceof EventEmitter].join());
}
