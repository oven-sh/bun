// node:http2 publishes the http2.* channels.
import { AsyncLocalStorage } from "node:async_hooks";
import { subscribe } from "node:diagnostics_channel";
import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";

const store = new AsyncLocalStorage();
const heard: string[] = [];
for (const side of ["client", "server"]) {
  for (const event of ["created", "start", "bodyChunkSent", "bodySent", "finish", "error", "close"]) {
    subscribe(`http2.${side}.stream.${event}`, ({ stream, headers, flags }: any) => {
      stream.path ??= headers[":path"];
      heard.push(
        `${side} ${stream.path} ${event} ${flags} ${stream.destroyed} ${side === "client" && store.getStore()}`,
      );
    });
  }
}

const server = http2.createServer().listen(0, "127.0.0.1");
server.on("stream", (stream: http2.ServerHttp2Stream, headers) => {
  if (headers[":path"] === "/late") {
    stream.resume().on("end", () => setImmediate(() => stream.respond({ ":status": 204 })));
    return;
  }
  stream.pushStream({ ":path": "/pushed" }, (error, pushed) => pushed.respond({}, { endStream: true }));
  stream.resume().respond();
  stream.end("body");
});
await once(server, "listening");

const session = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
const closed = (stream: http2.Http2Stream) => new Promise(resolve => stream.resume().on("close", resolve));
const pushed = once(session, "stream").then(([stream]) => closed(stream));
await closed(store.run("queued", () => session.request({ ":path": "/queued", ":method": "POST" }).end("body")));
await pushed;
await closed(store.run("late", () => session.request({ ":path": "/late" })));
await closed(session.request({ ":path": "/aborted" }, { signal: AbortSignal.abort() }).on("error", () => {}));
session.close();
server.close();
await once(server, "close");

for (const [, lines] of Map.groupBy(heard, line => line.split(" ", 2).join())
  .entries()
  .toArray()
  .sort()) {
  console.log(lines.join("\n"));
}
