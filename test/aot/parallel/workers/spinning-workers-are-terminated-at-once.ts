// Thirty-two Workers spin in loops that call nothing, loops that call, recursion, and loops in try blocks and finally blocks; all are terminated in one go, several rounds.
function plain(end: number): number {
  let sum = 0;
  for (let i = 0; i !== end; i = (i + 1) | 0) sum = (sum + i) | 0;
  return sum;
}
function step(n: number): number {
  return (n * 31 + 7) | 0;
}
function calling(end: number): number {
  let sum = 0;
  for (let i = 0; i !== end; i = (i + 1) | 0) sum = step(sum);
  return sum;
}
function inTry(end: number): number {
  let sum = 0;
  for (;;) {
    try {
      for (let i = 0; i !== end; i = (i + 1) | 0) sum = (sum + i) | 0;
      return sum;
    } catch {
      postMessage("caught the end");
    } finally {
      sum = 1;
    }
  }
}
function inFinally(end: number): number {
  try {
    throw new Error("into the finally");
  } catch {
    return 0;
  } finally {
    for (let i = 0; i !== end; i = (i + 1) | 0);
  }
}
function nested(end: number): number {
  let sum = 0;
  for (let a = 0; a !== end; a = (a + 1) | 0) for (let b = 0; b < 1000; b++) for (let c = 0; c < 10; c++) sum = (sum + a + b + c) | 0;
  return sum;
}
function up(n: number, end: number): number {
  return n === 200 ? 0 : 1 + up(n + 1, end);
}
function recursing(end: number): number {
  let sum = 0;
  while (sum !== end) sum = (sum + up(0, end)) % 1000;
  return sum;
}
function* forever(): Generator<number> {
  for (let i = 0; ; i++) yield i;
}
function generating(end: number): number {
  let sum = 0;
  for (const n of forever()) if ((sum = (sum + n) | 0) === end && n < 0) break;
  return sum;
}
function whileTrue(box: { stop: boolean }): number {
  let n = 0;
  while (!box.stop) n++;
  return n;
}
const spins = [plain, calling, inTry, inFinally, nested, recursing, generating, () => whileTrue({ stop: false })];

if (Bun.isMainThread) {
  const rounds = Number(process.env.COUNT ?? 2);
  const heard: string[] = [];
  for (let round = 0; round < rounds; round++) {
    const workers = Array.from({ length: 32 }, () => new Worker(new URL(import.meta.url)));
    await Promise.all(workers.map((worker, index) => new Promise<void>(resolve => {
      worker.onmessage = event => (event.data === "spins" ? resolve() : heard.push(event.data));
      worker.postMessage(index % spins.length);
    })));
    await new Promise(resolve => setTimeout(resolve, round * 5));
    const closed = workers.map(worker => new Promise<void>(resolve => worker.addEventListener("close", () => resolve())));
    for (const worker of workers) worker.terminate();
    await Promise.all(closed);
  }
  console.log("all closed;", JSON.stringify(heard));
} else {
  addEventListener("message", (event: MessageEvent<number>) => {
    postMessage("spins");
    // A loop of four thousand million rounds ends within seconds, and a slow machine takes longer than that to start thirty-two Workers.
    for (;;) spins[event.data](-1);
  });
}
