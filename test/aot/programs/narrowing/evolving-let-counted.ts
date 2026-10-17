// A `let` without a type or an initializer at the top level of a module with top-level `await`.
class Socket { handlers: Record<string, (e?: unknown) => void> = {}; on(name: string, f: (e?: unknown) => void) { this.handlers[name] = f; return this } end() { Promise.resolve().then(() => this.handlers["close"]?.()) } }
const connect = (options: { path: string }) => { const socket = new Socket(); Promise.resolve().then(() => socket.handlers["connect"]?.()); return socket }
const sleep = (ms: number) => new Promise<void>(done => Promise.resolve(ms).then(() => done()))
const isSlow = Number("0") === 1
const { promise, resolve } = Promise.withResolvers<void>();
Promise.resolve().then(() => resolve());
await promise;
const warmup_total = isSlow ? 100 : 300;
const measured_total = isSlow ? 200 : 500;

let started;

started = 0;
while (started < warmup_total) {
  const promises: Promise<void>[] = [];
  for (let i = 0; i < 100; i++) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = connect({ path: "p" })
      .on("connect", () => {
        socket.on("close", () => resolve());
        socket.end();
      })
      .on("error", e => {
        reject(e);
      });

    promises.push(promise);
    started++;
  }
  await Promise.all(promises);
  await sleep(1);
  if (started % 100 === 0) {
    console.log(`Completed ${started} connections.`);
  }
}

started = 0;
while (started < measured_total) {
  const promises: Promise<void>[] = [];
  for (let i = 0; i < 100; i++) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = connect({ path: "p" })
      .on("connect", () => {
        socket.on("close", () => resolve());
        socket.end();
      })
      .on("error", e => {
        reject(e);
      });

    promises.push(promise);
    started++;
  }
  await Promise.all(promises);
  await sleep(1);
  if (started % 100 === 0) {
    console.log(`Completed ${started} connections.`);
  }
}
console.log("done", started, typeof started)
export {}
