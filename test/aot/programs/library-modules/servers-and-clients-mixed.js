// The two kinds of server and the three kinds of client meet: fetch against node:http, node:http.request against Bun.serve, fetch against Bun.serve; a streamed body in both directions, JSON, form data, a redirect, an abort, and a WebSocket that echoes.
import http from "node:http";

const nodeServer = http.createServer(async (request, response) => {
  if (request.url === "/redirect") return response.writeHead(302, { location: "/target" }).end();
  if (request.url === "/slow") return void setTimeout(() => response.end("too late"), 5_000).unref();
  let body = "";
  for await (const part of request) body += part;
  response.setHeader("x-server", "node");
  response.end(request.method + " " + request.url + " " + body);
});
await new Promise(resolve => nodeServer.listen(0, "127.0.0.1", resolve));
const nodeUrl = "http://127.0.0.1:" + nodeServer.address().port;

const posted = await fetch(nodeUrl + "/post", { method: "POST", body: "from fetch" });
console.log(posted.status, posted.headers.get("x-server"), await posted.text());
const redirected = await fetch(nodeUrl + "/redirect");
console.log(redirected.redirected, new URL(redirected.url).pathname, await redirected.text());
console.log((await fetch(nodeUrl + "/redirect", { redirect: "manual" })).status);
console.log(await fetch(nodeUrl + "/slow", { signal: AbortSignal.timeout(20) }).catch(error => error.name));
const streamed = new ReadableStream({ start(controller) { controller.enqueue("a"); controller.enqueue("b"); controller.close(); } }).pipeThrough(new TextEncoderStream());
console.log(await (await fetch(nodeUrl + "/stream", { method: "PUT", body: streamed, duplex: "half" })).text());
nodeServer.closeAllConnections();
await new Promise(resolve => nodeServer.close(resolve));

const bunServer = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  routes: { "/route/:id": request => Response.json({ id: request.params.id }) },
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/socket") return server.upgrade(request) ? undefined : new Response("no upgrade", { status: 400 });
    if (url.pathname === "/form") return new Response([...(await request.formData()).entries()].join("|"));
    if (url.pathname === "/json") return Response.json({ got: await request.json() }, { status: 201 });
    if (url.pathname === "/pieces") return new Response(new ReadableStream({ async pull(controller) { controller.enqueue("piece "); controller.enqueue("by piece"); controller.close(); } }));
    return new Response("not found", { status: 404 });
  },
  websocket: { message(socket, message) { socket.send("echo " + message); }, close() {} },
});
const form = new FormData();
form.append("a", "1");
form.append("b", "two");
console.log(await (await fetch(new URL("/form", bunServer.url), { method: "POST", body: form })).text());
const json = await fetch(new URL("/json", bunServer.url), { method: "POST", body: JSON.stringify([1, 2]) });
console.log(json.status, JSON.stringify(await json.json()), json.headers.get("content-type"));
console.log(await (await fetch(new URL("/pieces", bunServer.url))).text(), (await fetch(new URL("/nowhere", bunServer.url))).status, JSON.stringify(await (await fetch(new URL("/route/7", bunServer.url))).json()));
console.log(await new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: bunServer.port, path: "/pieces" }, response => { let text = ""; response.on("data", part => (text += part)).on("end", () => resolve(response.statusCode + " " + text)); }).on("error", reject)));
const socket = new WebSocket("ws://127.0.0.1:" + bunServer.port + "/socket");
await new Promise(resolve => (socket.onopen = resolve));
socket.send("over a socket");
console.log((await new Promise(resolve => (socket.onmessage = resolve))).data, socket.readyState);
socket.close();
await new Promise(resolve => (socket.onclose = resolve));
await bunServer.stop(true);
