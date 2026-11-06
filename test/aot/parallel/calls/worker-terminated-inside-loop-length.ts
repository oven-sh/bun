// The length of an array is set to billions while the array holds three elements. A Worker walks up to that length: without reading, reading by index, with for-of, and with the length
// as a limit that it tests by itself. The last loops walk far past the end of a short array, so that every turn goes the unlikely way. Each way would take many seconds to end, calls
// nothing that the program wrote and allocates nothing: only the polls of the loops let the Worker be terminated inside them. The Worker counts the walks that came to their end
// where the main thread sees it: terminated inside its first walk, it has counted none.
let kept = 0;

function countsUpToLength(list: number[], divisor: number): void {
  let sum = 1;
  for (let k = 0; k < list.length; k++) sum = (((sum + k) | 0) % divisor) | 0;
  kept = sum;
}

function readsByIndex(list: number[], divisor: number): void {
  let sum = 1;
  for (let k = 0; k < list.length; k++) sum = (((sum + (list[k] === undefined ? k : 2)) | 0) % divisor) | 0;
  kept = sum;
}

function readsWithForOf(list: number[], divisor: number): void {
  let sum = 1;
  for (const value of list) sum = (((sum + (value === undefined ? 1 : 2)) | 0) % divisor) | 0;
  kept = sum;
}

function testsAgainstLength(list: number[], turns: number, weights: Int32Array): void {
  let sum = 1;
  for (let k = 0; k < turns; k++) {
    if (k >= list.length) throw new RangeError("past the end");
    sum = (((sum + k) | 0) % weights[k & 7]!) | 0;
  }
  kept = sum;
}

function walksPastTheEnd(list: number[], turns: number): void {
  let sum = 0;
  for (let k = 0; k < turns; k++) sum = (sum + (list[k] === undefined ? 1 : 2)) | 0;
  for (let k = 0; k < turns; k++) sum = (sum + (list[k] === undefined ? 3 : 4)) | 0;
  for (let k = 0; k < turns; k++) sum = (sum + (list[k] === undefined ? 5 : 6)) | 0;
  for (let k = 0; k < turns; k++) sum = (sum + (list[k] === undefined ? 7 : 8)) | 0;
  kept = sum;
}

type Order = { way: string; length: number; walksEnded: Int32Array };

if (Bun.isMainThread) {
  for (const way of ["counts up to the length", "reads by index", "reads with for-of", "tests against the length", "walks past the end"]) {
    const worker = new Worker(new URL(import.meta.url));
    const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    const walksEnded = new Int32Array(new SharedArrayBuffer(4));
    worker.postMessage({ way, length: 0x7ffffff0, walksEnded } satisfies Order);
    console.log("the Worker:", await started);
    await new Promise(resolve => setTimeout(resolve, 50));
    worker.terminate();
    await closed;
    console.log("the Worker is closed, walks that came to their end:", walksEnded[0], kept);
  }
} else {
  addEventListener("message", (event: MessageEvent<Order>) => {
    const { way, length, walksEnded } = event.data;
    const weights = Int32Array.from({ length: 8 }, (_, k) => k + 3);
    const divisor = (length >>> 20) | 1;
    const short: number[] = [length, length + 1, length + 2.5];
    const long: number[] = [length, length + 1, length + 2.5];
    long.length = length;
    postMessage(way);
    for (let round = 0; round < length; round++) {
      if (way === "counts up to the length") countsUpToLength(long, divisor);
      else if (way === "reads by index") readsByIndex(long, divisor);
      else if (way === "reads with for-of") readsWithForOf(long, divisor);
      else if (way === "tests against the length") testsAgainstLength(long, length, weights);
      else walksPastTheEnd(short, length >>> 0);
      walksEnded[0] = round + 1;
    }
    postMessage("kept " + kept);
  });
}
