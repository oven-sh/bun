// A Worker runs a loop that tests its counter against a number of the program and throws past it. The number is so large that the loop would go on for years. It calls nothing and
// allocates nothing, so only its poll lets the Worker be terminated: with one counter that rises, with one that falls, and with two that meet.
const weights = Int32Array.from({ length: 8 }, (_, k) => k + 3);
let kept = 0;

function walkUp(turns: number, end: number): void {
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    if (k + 1 >= end) throw new RangeError("past the end");
    sum = (sum + weights[k & 7]!) | 0;
  }
  kept = sum;
}

function walkDown(turns: number, end: number): void {
  let sum = 0;
  for (let k = turns; k > 0; k--) {
    if (k >= end) throw new RangeError("past the end");
    sum = (sum + weights[k & 7]!) | 0;
  }
  kept = sum;
}

function meet(low: number, high: number, end: number): void {
  let sum = 0;
  while (low < high) {
    if (low >= end || high >= end) throw new RangeError("past the end");
    sum = (sum + weights[low & 7]! + weights[high & 7]!) | 0;
    low++;
    high--;
  }
  kept = sum;
}

type Order = { way: string; turns: number };

if (Bun.isMainThread) {
  for (const way of ["up", "down", "to the middle"]) {
    const worker = new Worker(new URL(import.meta.url));
    const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    worker.postMessage({ way, turns: 0xfffffff0 } satisfies Order);
    console.log("the Worker:", await started);
    await new Promise(resolve => setTimeout(resolve, 50));
    worker.terminate();
    await closed;
    console.log("the Worker is closed", kept);
  }
} else {
  addEventListener("message", (event: MessageEvent<Order>) => {
    const turns = (event.data.turns >>> 1) * 4194304;
    postMessage("walks " + event.data.way);
    if (event.data.way === "up") walkUp(turns, turns + 2);
    else if (event.data.way === "down") walkDown(turns, turns + 2);
    else meet(0, turns, turns + 2);
    postMessage("kept " + kept);
  });
}
