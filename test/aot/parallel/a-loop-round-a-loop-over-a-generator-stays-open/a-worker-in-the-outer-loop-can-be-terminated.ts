// A Worker runs an endless loop round a loop over a generator whose yields stand in no loop of its own. It calls nothing that is not compiled into it and allocates nothing,
// so only the poll of the outer loop lets the Worker be terminated.
function* pair(first: number, second: number) { yield first; yield second; }
function spin(end: number): number {
  let total = 0;
  for (let round = 0; round !== end; round = (round + 1) | 0) { for (const value of pair(1, 2)) total = (total + value) | 0; }
  return total;
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
