// A Worker walks a view of 256 MB in a loop that ends below a number. The view is only read, so most systems never give it memory of its own. One walk takes seconds, calls nothing and
// allocates nothing: however many elements a view holds, the loop has to look up from them often enough for the Worker to be terminated soon.
let kept = 0;

function walk(view: Uint8Array, limit: number): void {
  let hits = 1;
  for (let i = 0; i < limit; i++) hits = ((((((hits + i) | 0) % (view[i]! + 7)) + i) | 0) % (view[i]! + 11)) | 0;
  kept = hits;
}

if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
  worker.postMessage(0x10000000);
  console.log("the Worker:", await started);
  await new Promise(resolve => setTimeout(resolve, 30));
  const asked = performance.now();
  worker.terminate();
  await closed;
  console.log("the Worker is closed, soon:", performance.now() - asked < 1000, kept);
} else {
  addEventListener("message", (event: MessageEvent<number>) => {
    const count = event.data;
    const view = new Uint8Array(count);
    postMessage("walks");
    for (let round = 0; round < count; round++) walk(view, count);
    postMessage("kept " + kept);
  });
}
