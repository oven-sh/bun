// A Worker walks a view of 256 MB in a loop that ends below a number. The view is only read, so most systems never give it memory of its own. One walk takes seconds, calls nothing and
// allocates nothing: however many elements a view holds, the loop has to look up from them often enough for the Worker to be terminated inside it. The Worker counts the walks that
// came to their end where the main thread sees it: terminated inside its first walk, it has counted none.
let kept = 0;

function walk(view: Uint8Array, limit: number): void {
  let hits = 1;
  for (let i = 0; i < limit; i++) hits = ((((((hits + i) | 0) % (view[i]! + 7)) + i) | 0) % (view[i]! + 11)) | 0;
  kept = hits;
}

type Order = { count: number; walksEnded: Int32Array };

if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
  const walksEnded = new Int32Array(new SharedArrayBuffer(4));
  worker.postMessage({ count: 0x10000000, walksEnded } satisfies Order);
  console.log("the Worker:", await started);
  await new Promise(resolve => setTimeout(resolve, 30));
  worker.terminate();
  await closed;
  console.log("the Worker is closed, walks that came to their end:", walksEnded[0], kept);
} else {
  addEventListener("message", (event: MessageEvent<Order>) => {
    const { count, walksEnded } = event.data;
    const view = new Uint8Array(count);
    postMessage("walks");
    for (let round = 0; round < count; round++) {
      walk(view, count);
      walksEnded[0] = round + 1;
    }
    postMessage("kept " + kept);
  });
}
