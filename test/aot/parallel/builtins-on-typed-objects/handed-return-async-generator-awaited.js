// What is handed to return() of an async generator is awaited: the `then` of an object is called, the `constructor` of a promise is read, and a promise gets a reaction.
const log = [];
async function* steps() { try { yield 1; yield 2; } finally { log.push("finally"); } }
class Later { constructor(v) { this.v = v; this.calls = 0; } then(resolve) { this.calls++; log.push("then " + this.v); resolve(this.v * 2); } }
async function main() {
  const fresh = steps();
  const a = new Later(4);
  console.log(JSON.stringify(await fresh.return(a)), a.calls);
  const started = steps();
  await started.next();
  const b = new Later(5);
  console.log(JSON.stringify(await started.return(b)), b.calls);
  const done = steps();
  for await (const _ of done) {}
  const c = new Later(6);
  console.log(JSON.stringify(await done.return(c)), c.calls);
  const withGetter = steps();
  const promise = Promise.resolve(7);
  Object.defineProperty(promise, "constructor", { get() { log.push("constructor read"); return Promise; } });
  console.log(JSON.stringify(await withGetter.return(promise)));
  const rejected = Promise.reject(new Error("no"));
  try { await steps().return(rejected); } catch (e) { console.log("caught", e.message); }
  const thrower = { get then() { log.push("then read"); throw new RangeError("then"); } };
  try { await steps().return(thrower); } catch (e) { console.log("caught", e.name); }
  let sum = 0;
  for (let i = 0; i < 3000; i++) { const l = new Later(i); sum += (await steps().return(l)).value + l.calls; }
  console.log(sum, log.length, log.slice(0, 8).join());
}
main();
