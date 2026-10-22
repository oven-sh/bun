// node:http2 over a plain socket: a server with streams, a client session, request and response headers, a body in both directions, several streams on one session, a status of 404, the compatibility interface, and the end of the session.
import http2 from "node:http2";
import { once } from "node:events";

const server = http2.createServer();
server.on("stream", (stream, headers) => {
  const path = headers[":path"];
  if (path === "/echo") {
    stream.respond({ ":status": 200, "x-method": headers[":method"] });
    return stream.pipe(stream);
  }
  if (path === "/missing") return stream.respond({ ":status": 404 }, { endStream: true });
  stream.respond({ ":status": 200, "content-type": "text/plain" });
  stream.end("hello " + path);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const session = http2.connect("http://127.0.0.1:" + server.address().port);
await once(session, "connect");

async function ask(headers, body) {
  const stream = session.request(headers, { endStream: body === undefined });
  if (body !== undefined) stream.end(body);
  const [response] = await once(stream, "response");
  let text = "";
  stream.setEncoding("utf8");
  for await (const part of stream) text += part;
  return [response[":status"], response["x-method"], response["content-type"], text].join(" | ");
}
console.log(await ask({ ":path": "/a" }));
console.log(await ask({ ":path": "/echo", ":method": "POST" }, "sent up and back"));
console.log(await ask({ ":path": "/missing" }));
console.log((await Promise.all([1, 2, 3].map(n => ask({ ":path": "/" + n })))).join(" ; "));
console.log(session.encrypted, session.closed, session.destroyed, typeof session.localSettings.maxConcurrentStreams, http2.constants.HTTP2_HEADER_STATUS, http2.constants.NGHTTP2_NO_ERROR, typeof http2.getDefaultSettings().initialWindowSize);
await new Promise(resolve => session.close(resolve));
console.log(session.closed);
await new Promise(resolve => server.close(resolve));

const compatible = http2.createServer((request, response) => {
  response.setHeader("x-version", request.httpVersion);
  response.end(request.method + " " + request.url);
});
compatible.listen(0, "127.0.0.1");
await once(compatible, "listening");
const second = http2.connect("http://127.0.0.1:" + compatible.address().port);
const stream = second.request({ ":path": "/compat" });
const [headers] = await once(stream, "response");
let text = "";
for await (const part of stream) text += part;
console.log(headers["x-version"], text);
second.close();
await new Promise(resolve => compatible.close(resolve));
