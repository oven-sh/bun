// A Worker runs counted loops of two thousand million turns, over and over. They call nothing and allocate nothing. Such a loop polls once in 2 ** 20 turns, and that poll lets the Worker be terminated.
function spin(rounds: number, turns: number): number {
  let sum = 0;
  for (let round = 0; round !== rounds; round = (round + 1) | 0) {
    for (let i = 0; i < turns; i++) sum = (sum + i) | 0;
    for (let i = turns; i > 0; i -= 3) sum = (sum ^ i) | 0;
  }
  return sum;
}

if (Bun.isMainThread) {
  console.log("loops that end:", spin(2, 10), spin(1, 3_000_000));
  const worker = new Worker(new URL(import.meta.url));
  const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
  worker.postMessage(2_000_000_000);
  console.log("the Worker:", await started);
  await new Promise(resolve => setTimeout(resolve, 50));
  worker.terminate();
  await closed;
  console.log("the Worker is closed");
} else {
  addEventListener("message", (event: MessageEvent<number>) => {
    postMessage("enters the loops");
    postMessage("left the loops with " + spin(-1, event.data));
  });
}
