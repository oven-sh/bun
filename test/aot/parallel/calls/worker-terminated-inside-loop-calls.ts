// A Worker runs an endless loop that calls nothing and allocates nothing, so only the poll of the loop lets it be terminated. Where that poll is a test and a call, the call has to say that the thread was terminated.
function spin(end: number): number {
  let sum = 0;
  for (let i = 0; i !== end; i = (i + 1) | 0) sum = (sum + i) | 0;
  return sum;
}

if (Bun.isMainThread) {
  console.log("a loop that ends:", spin(10));
  const worker = new Worker(new URL(import.meta.url));
  const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
  worker.postMessage(0.5);
  console.log("the Worker:", await started);
  await new Promise(resolve => setTimeout(resolve, 50));
  worker.terminate();
  await closed;
  console.log("the Worker is closed");
} else {
  addEventListener("message", (event: MessageEvent<number>) => {
    postMessage("enters the loop");
    postMessage("left the loop with " + spin(event.data));
  });
}
