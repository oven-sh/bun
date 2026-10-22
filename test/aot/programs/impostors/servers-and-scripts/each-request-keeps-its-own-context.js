import { AsyncLocalStorage, AsyncResource, executionAsyncId } from "node:async_hooks";
import http from "node:http";

const context = new AsyncLocalStorage();
const lines = [];
const log = message => lines.push((context.getStore()?.id ?? "none") + ": " + message);

async function work(ms) {
  log("work starts");
  await new Promise(resolve => setTimeout(resolve, ms));
  log("after a timer");
  await Promise.all([Promise.resolve().then(() => log("in a reaction")), new Promise(resolve => setImmediate(() => resolve(log("in an immediate"))))]);
  process.nextTick(() => log("in a tick"));
  queueMicrotask(() => log("in a microtask"));
}

const server = http.createServer((request, response) => {
  context.run({ id: request.headers["x-id"] }, async () => {
    await work(Number(request.headers["x-wait"]));
    response.end(context.getStore().id);
  });
});

server.listen(0, "127.0.0.1", async () => {
  const ask = (id, wait) => fetch("http://127.0.0.1:" + server.address().port, { headers: { "x-id": id, "x-wait": String(wait) } }).then(answer => answer.text());
  console.log(await Promise.all([ask("a", 15), ask("b", 5), ask("c", 10)]));
  console.log(lines.filter(line => line.startsWith("a")), lines.filter(line => line.startsWith("b")).length, lines.filter(line => line.startsWith("none")).length);
  server.close();

  console.log(context.getStore(), context.run(1, () => context.run(2, () => context.getStore()) + context.getStore()), context.run("x", (a, b) => a + b + context.getStore(), "p", "q"));
  context.enterWith("entered");
  console.log(context.getStore(), context.exit(() => context.getStore()));
  const bound = context.run("bound", () => AsyncLocalStorage.bind(() => context.getStore()));
  const snapshot = context.run("snapshot", () => AsyncLocalStorage.snapshot());
  console.log(bound(), snapshot(() => context.getStore()), typeof executionAsyncId());
  const resource = context.run("resource", () => new AsyncResource("Job"));
  console.log(resource.runInAsyncScope((a, b) => context.getStore() + a + b, null, 1, 2));
  context.disable();
  console.log(context.getStore());
});
