// A Worker runs an endless cycle of tail calls: the stack does not grow and no loop is in sight, so only a poll at the tail calls lets it be terminated. Both functions also call themselves, so neither leaves its stack check to its callers.
function ping(count: number, depth: number, trace: number[]): number {
  if (depth > 0) return trace.push(count) + ping(count, depth - 1, trace);
  if (count < 0) return trace.length;
  return pong(count + 1, depth, trace);
}
function pong(count: number, depth: number, trace: number[]): number {
  if (depth > 0) return trace.push(-count) + pong(count, depth - 1, trace);
  if (count < 0) return trace.length;
  return ping(count === 1e9 ? 0 : count + 1, depth, trace);
}

if (Bun.isMainThread) {
  console.log("a cycle that ends:", ping(-1, 3, []), pong(-5, 2, []));
  const worker = new Worker(new URL(import.meta.url));
  const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
  worker.postMessage(2);
  console.log("the Worker:", await started);
  await new Promise(resolve => setTimeout(resolve, 50));
  worker.terminate();
  await closed;
  console.log("the Worker is closed");
} else {
  addEventListener("message", (event: MessageEvent<number>) => {
    postMessage("enters the cycle");
    postMessage("left the cycle with " + ping(0, event.data, []));
  });
}
