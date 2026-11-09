// What one thread plants on the objects that all modules of a thread share, and the functions it puts in the place of built-ins, no other thread finds: not the main thread, nor a worker that started before it, beside it or after its end.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const MARK = "__planted";
const members = (): [string, object, string][] => [
  ["JSON.stringify", JSON, "stringify"],
  ["JSON.parse", JSON, "parse"],
  ["Map.prototype.set", Map.prototype, "set"],
  ["Array.prototype.join", Array.prototype, "join"],
  ["String.prototype.split", String.prototype, "split"],
  ["Object.assign", Object, "assign"],
  ["structuredClone", globalThis, "structuredClone"],
  ["TextEncoder.prototype.encode", TextEncoder.prototype, "encode"],
  ["Headers.prototype.set", Headers.prototype, "set"],
  ["RegExp.prototype.exec", RegExp.prototype, "exec"],
  ["postMessage", globalThis, "postMessage"],
  ["fetch", globalThis, "fetch"],
  ["Date.now", Date, "now"],
  ["Math.random", Math, "random"],
  ["setTimeout", globalThis, "setTimeout"],
  ["console.log", console, "log"],
  ["http.request", require("node:http"), "request"],
  ["fs.readFileSync", require("node:fs"), "readFileSync"],
];
const places = (): [string, object][] => [
  ["globalThis", globalThis],
  ["Object.prototype", Object.prototype],
  ["Array.prototype", Array.prototype],
  ["Function.prototype", Function.prototype],
  ["Error.prototype", Error.prototype],
  ["Object", Object],
  ["Math", Math],
  ["JSON", JSON],
  ["console", console],
  ["process", process],
  ["process.env", process.env],
  ["Bun", Bun],
  ["Bun.env", Bun.env],
  ["node:http", require("node:http")],
  ["node:fs", require("node:fs")],
  ...members().map(([name, holder, key]): [string, object] => [name, Reflect.get(holder, key) as object]),
];
const found = (): string =>
  [
    ...places().filter(([, place]) => MARK in place).map(([name]) => name),
    ...members().filter(([, holder, key]) => (Reflect.get(holder, key) as Function).name === "planted").map(([name]) => name + " replaced"),
  ].join() || "nothing";

function plant(): number {
  let took = 0;
  for (const [, place] of places()) took += Number(Reflect.set(place, MARK, "here"));
  for (const [, holder, key] of members()) {
    const original = Reflect.get(holder, key) as Function;
    took += Number(Reflect.set(holder, key, function planted(this: unknown, ...values: unknown[]) {
      return Reflect.apply(original, this, values);
    }));
  }
  return took;
}

if (Bun.isMainThread) {
  const log = console.log;
  const start = () => new Worker(new URL(import.meta.url));
  const ask = (worker: Worker, what: string) =>
    new Promise<string>(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.postMessage(what);
    });
  const before = start();
  log("before, at its start:", await ask(before, "found"));
  const planter = start();
  log("the planter, at its start:", await ask(planter, "found"));
  log("the planter plants something:", Number(await ask(planter, "plant")) > 20);
  log("the planter finds its own:", (await ask(planter, "found")).split(",").length > 20);
  const beside = start();
  log("before:", await ask(before, "found"));
  log("beside:", await ask(beside, "found"));
  log("main:", found());
  await planter.terminate();
  const after = start();
  log("after:", await ask(after, "found"));
  log("before, once more:", await ask(before, "found"));
  log("main plants something:", plant() > 20);
  const afterMain = start();
  log("after main:", await ask(afterMain, "found"));
  log("beside, once more:", await ask(beside, "found"));
  for (const worker of [before, beside, after, afterMain]) worker.terminate();
} else {
  const post = postMessage;
  addEventListener("message", (event: MessageEvent<string>) => post(event.data === "plant" ? String(plant()) : found()));
}
