// fetch() and WebSocket publish the undici:* channels, in the async context of their caller.
import { AsyncLocalStorage } from "node:async_hooks";
import { subscribe } from "node:diagnostics_channel";

const store = new AsyncLocalStorage();
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request, server) {
    if (server.upgrade(request)) return;
    return request.url.endsWith("/to") ? Response.redirect("/") : new Response(request.headers.get("added"));
  },
  websocket: {
    open(ws) {
      ws.ping("ping");
      ws.close(3000, "reason");
    },
    message() {},
  },
});

console.log(await (await fetch(server.url, { keepalive: false })).text());

subscribe("undici:request:create", ({ request }: any) => request.addHeader("added", request.path));
for (const name of [
  "client:beforeConnect",
  "client:connected",
  "client:connectError",
  "client:sendHeaders",
  "request:create",
  "request:bodyChunkSent",
  "request:bodySent",
  "request:headers",
  "request:bodyChunkReceived",
  "request:trailers",
  "request:error",
  "websocket:open",
  "websocket:ping",
  "websocket:close",
]) {
  subscribe("undici:" + name, (message: any) =>
    console.log(name, Object.keys(message).join(), message.request?.path, store.getStore()),
  );
}

const post = () => fetch(server.url + "to", { method: "POST", body: "body", keepalive: false });
console.log(await (await store.run("fetch", post)).text());

const controller = new AbortController();
subscribe("undici:request:create", ({ request }: any) => request.path === "/aborted" && controller.abort("reason"));
console.log(await fetch(server.url + "aborted", { signal: controller.signal }).catch(error => error));

const ws = store.run("ws", () => new WebSocket(server.url));
await new Promise(resolve => (ws.onclose = resolve));
await server.stop(true);
console.log(await fetch(server.url).catch(error => error.code));
