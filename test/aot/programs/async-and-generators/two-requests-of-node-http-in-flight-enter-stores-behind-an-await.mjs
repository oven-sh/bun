// Two requests are in flight in a server of node:http. Each enters a store of its own behind an await, and says which store it sees when it starts, goes on and answers.
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";
const store = new AsyncLocalStorage();
const lines = [];
const firstHasEntered = Promise.withResolvers();
const secondHasStarted = Promise.withResolvers();
const server = createServer(async (request, response) => {
  const id = request.url;
  lines.push(`${id} starts under ${store.getStore()}`);
  await 0;
  lines.push(`${id} goes on under ${store.getStore()}`);
  store.enterWith(id);
  if (id === "/first") {
    firstHasEntered.resolve();
    await secondHasStarted.promise;
  } else secondHasStarted.resolve();
  await 0;
  response.end(`${id} answers under ${store.getStore()}`);
});
await new Promise(resolve => server.listen(0, resolve));
const origin = `http://localhost:${server.address().port}`;
const first = fetch(`${origin}/first`);
await firstHasEntered.promise;
const second = fetch(`${origin}/second`);
lines.push(await (await first).text(), await (await second).text());
console.log(lines.join("\n"));
server.close();
