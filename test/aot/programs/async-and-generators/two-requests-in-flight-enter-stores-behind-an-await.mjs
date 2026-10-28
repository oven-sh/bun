// Two requests are in flight in Bun.serve. Each enters a store of its own behind an await, and says which store it sees when it starts, goes on and answers.
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage();
const lines = [];
const firstHasEntered = Promise.withResolvers();
const secondHasStarted = Promise.withResolvers();
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const id = new URL(request.url).pathname;
    lines.push(`${id} starts under ${store.getStore()}`);
    await 0;
    lines.push(`${id} goes on under ${store.getStore()}`);
    store.enterWith(id);
    if (id === "/first") {
      firstHasEntered.resolve();
      await secondHasStarted.promise;
    } else secondHasStarted.resolve();
    await 0;
    return new Response(`${id} answers under ${store.getStore()}`);
  },
});
const first = fetch(new URL("/first", server.url));
await firstHasEntered.promise;
const second = fetch(new URL("/second", server.url));
lines.push(await (await first).text(), await (await second).text());
console.log(lines.join("\n"));
server.stop(true);
