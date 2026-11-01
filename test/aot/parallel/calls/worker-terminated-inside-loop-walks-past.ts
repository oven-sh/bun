// A Worker runs a loop over a typed array whose counter nothing bounds: outside the array every read gives undefined and the loop goes on for ever. It calls nothing and allocates nothing,
// so only its poll lets the Worker be terminated, upward and downward alike.
const samples = Float64Array.from({ length: 64 }, (_, k) => k / 3);
let kept = 0;

function walkUp(): void {
  let sum = 0;
  for (let k = 0; ; k++) {
    sum += samples[k]!;
    kept = sum;
  }
}

function walkDown(): void {
  let sum = 0;
  for (let k = 63; ; k--) {
    sum += samples[k]!;
    kept = sum;
  }
}

if (Bun.isMainThread) {
  for (const direction of ["up", "down"]) {
    const worker = new Worker(new URL(import.meta.url));
    const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    worker.postMessage(direction);
    console.log("the Worker:", await started);
    await new Promise(resolve => setTimeout(resolve, 50));
    worker.terminate();
    await closed;
    console.log("the Worker is closed", kept);
  }
} else {
  addEventListener("message", (event: MessageEvent<string>) => {
    postMessage("walks " + event.data);
    if (event.data === "up") walkUp();
    else walkDown();
  });
}
