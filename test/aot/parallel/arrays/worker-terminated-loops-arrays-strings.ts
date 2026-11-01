// A worker is terminated between loops over arrays and strings.
function sumOfElements(list: number[]): number {
  let sum = 0;
  for (let index = 0; index < list.length; index++) sum += list[index];
  return sum;
}
function sumOfCodeUnits(text: string): number {
  let sum = 0;
  for (let index = 0; index < text.length; index++) sum = (sum + text.charCodeAt(index)) | 0;
  return sum;
}
function sumOfBytes(bytes: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < bytes.length; index++) sum += bytes[index];
  return sum;
}
function sumOfValues(list: number[]): number {
  let sum = 0;
  for (const value of list) sum += value;
  return sum;
}
function spin(list: number[], text: string, bytes: Uint8Array, rounds: number): number {
  let sum = 0;
  for (let round = 0; round !== rounds; round++) {
    for (let index = 0; index < list.length; index++) sum = (sum + list[index]) | 0;
    for (let index = 0; index < text.length; index++) sum = (sum + text.charCodeAt(index)) | 0;
    for (let index = 0; index < bytes.length; index++) sum = (sum + bytes[index]) | 0;
    sum = (sum + sumOfElements(list) + sumOfCodeUnits(text) + sumOfBytes(bytes) + sumOfValues(list)) | 0;
  }
  return sum;
}
function growsWhileCounted(list: number[], limit: number): number {
  for (let index = 0; index < list.length; index++) {
    if (list.length < limit) list.push(index);
  }
  return list.length;
}
function shrinksWhileCounted(list: number[]): number {
  let rounds = 0;
  for (let index = 0; index < list.length; index++) {
    list.pop();
    rounds++;
  }
  return rounds;
}

if (Bun.isMainThread) {
  console.log("loops that end:", spin([1, 2, 3.5], "text", new Uint8Array([4, 5]), 3), growsWhileCounted([0], 1000), shrinksWhileCounted([1, 2, 3, 4, 5, 6, 7]));
  const worker = new Worker(new URL(import.meta.url));
  const started = new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data)));
  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
  worker.postMessage(-1);
  console.log("the Worker:", await started);
  await new Promise(resolve => setTimeout(resolve, 50));
  worker.terminate();
  await closed;
  console.log("the Worker is closed");
} else {
  addEventListener("message", (event: MessageEvent<number>) => {
    postMessage("enters the loops");
    postMessage("left the loops with " + spin([1, 2, 3], "some text", new Uint8Array(16), event.data));
  });
}
