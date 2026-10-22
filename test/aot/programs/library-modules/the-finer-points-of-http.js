// node:http beyond a plain request: an upgrade to a raw socket, trailers, 100-continue, early hints left aside, a request that times out, one that the client destroys, a response piped from the request, many headers of one name, the tables of codes and methods, header validation, and what the server knows about its connections.
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

const server = http.createServer((request, response) => {
  if (request.url === "/trailers") {
    response.writeHead(200, { trailer: "x-sum" });
    response.write("body");
    response.addTrailers({ "x-sum": "4" });
    return response.end();
  }
  if (request.url === "/pipe") return request.pipe(response);
  if (request.url === "/cookies") {
    response.setHeader("set-cookie", ["a=1", "b=2"]);
    response.appendHeader("set-cookie", "c=3");
    return response.end(JSON.stringify([request.headers.cookie, request.headersDistinct["x-many"], request.rawHeaders.filter(name => name.toLowerCase() === "x-many").length, response.getHeaderNames(), response.hasHeader("Set-Cookie")]));
  }
  if (request.url === "/never") return;
  response.end("plain");
});
server.on("checkContinue", (request, response) => { response.writeContinue(); request.pipe(response); });
server.on("upgrade", (request, socket, head) => {
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n");
  socket.on("data", part => socket.end("raw " + part));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = { host: "127.0.0.1", port: server.address().port };
const body = async response => { let text = ""; for await (const part of response) text += part; return text; };

const [trailed] = await once(http.get({ ...base, path: "/trailers" }), "response");
console.log(await body(trailed), JSON.stringify(trailed.trailers), trailed.complete);
const piped = http.request({ ...base, path: "/pipe", method: "POST" });
piped.write("first ");
piped.end("second");
console.log(await body((await once(piped, "response"))[0]));
const many = http.request({ ...base, path: "/cookies", headers: { cookie: "x=y", "x-many": ["1", "2"] } }).end();
const [cookies] = await once(many, "response");
console.log(await body(cookies), JSON.stringify(cookies.headers["set-cookie"]));
const waits = http.request({ ...base, path: "/continue", method: "POST", headers: { expect: "100-continue" } });
await once(waits, "continue");
waits.end("sent after continue");
console.log(await body((await once(waits, "response"))[0]));
const upgrading = http.request({ ...base, headers: { connection: "Upgrade", upgrade: "echo" } }).end();
const [answer, socket] = await once(upgrading, "upgrade");
socket.write("bytes");
console.log(answer.statusCode, answer.headers.upgrade, (await once(socket, "data"))[0].toString(), socket instanceof net.Socket);
const slow = http.request({ ...base, path: "/never", timeout: 10 }).end();
await once(slow, "timeout");
slow.destroy();
console.log("timed out", (await once(slow, "error"))[0].code, slow.destroyed);
const dropped = http.get({ ...base, path: "/never" });
await once(dropped, "socket");
dropped.destroy(new Error("dropped by the client"));
console.log((await once(dropped, "error"))[0].message);

console.log(http.STATUS_CODES[418], http.METHODS.includes("PATCH"), http.METHODS.length > 30, http.maxHeaderSize, typeof http.globalAgent.maxSockets, http.globalAgent instanceof http.Agent, server.keepAliveTimeout, server.requestTimeout, server.headersTimeout, server.maxHeadersCount, server.timeout);
for (const check of [() => http.validateHeaderName("bad name"), () => http.validateHeaderValue("x", "bad\nvalue"), () => http.request({ ...base, method: "BAD METHOD" }), () => http.request({ ...base, path: "/with space" })]) {
  try {
    check();
    console.log("accepted");
  } catch (error) {
    console.log(error.code);
  }
}
console.log(typeof http.IncomingMessage, typeof http.ServerResponse, typeof http.OutgoingMessage, typeof http.ClientRequest, typeof http.Server, server instanceof net.Server);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
