// node:net and node:http publish the net.* and http.* channels.
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

const get = (path: string, fields = "Host: a\r\n") => `GET ${path} HTTP/1.1\r\n${fields}\r\n`;

async function exchange(front: (server: http.Server) => net.Server, ...requests: string[]) {
  let first: http.ServerResponse;
  const server = http.createServer((req, res) => {
    if (req.url === "/first") return void (first = res);
    if (!res.writableEnded) res.end(req.url);
    if (req.url === "/last") first.end("/first");
  });
  const listener = front(server).listen(0, "127.0.0.1");
  await once(listener, "listening");
  const socket = net.connect((listener.address() as net.AddressInfo).port, "127.0.0.1");
  let text = "";
  socket.on("data", chunk => (text += chunk));
  // One after the other: from the second on, a request comes on a connection that has served one.
  for (const request of requests.slice(0, -1)) {
    const answered = text.length;
    socket.write(request);
    while (text.length === answered || !text.endsWith(request.split(" ")[1])) await once(socket, "data");
  }
  socket.write(requests.at(-1)!);
  await once(socket, "close");
  listener.close();
  console.log(JSON.stringify(text.replace(/Date: .*\r\n/g, "")));
}

const keys = (message: unknown, name: string | symbol) => console.log(name, Object.keys(message as object).join());
const ofServer = ({ request, response }: any, name: string | symbol) => {
  console.log(name, request.url, response.statusCode, response.writableEnded);
  if (request.url === "/early" && name === "http.server.response.created") response.end("early");
};
const pipelined = get("/first") + get("/early") + get("/last", "Host: a\r\nConnection: close\r\n");

for (const front of [
  (server: http.Server) => server,
  (server: http.Server) => net.createServer(socket => server.emit("connection", socket)),
]) {
  await exchange(front, get("/unheard"), get("/unheard"), get("/no-host", ""));
  for (const name of ["response.created", "request.start", "response.finish"]) {
    subscribe("http.server." + name, ofServer);
    await exchange(front, get("/a"), get("/b"), get("/no-host", ""));
  }
  await exchange(front, pipelined);
  for (const name of ["response.created", "request.start", "response.finish"]) {
    unsubscribe("http.server." + name, ofServer);
  }
}

for (const event of ["asyncStart", "asyncEnd", "error"]) subscribe("tracing:net.server.listen:" + event, keys);
for (const event of ["request.created", "request.start", "request.error", "response.finish"]) {
  subscribe("http.client." + event, keys);
}
subscribe("net.client.socket", keys);
subscribe("net.server.socket", keys);

const server = http.createServer((req, res) => res.end()).listen();
await once(server, "listening");
const { port } = server.address() as net.AddressInfo;
const [response] = await once(http.get({ port, host: "127.0.0.1", agent: false }), "response");
await once(response.resume(), "close");
await once(net.createServer().listen(port), "error");
server.close();
await once(server, "close");
await once(http.get({ port, host: "127.0.0.1", agent: false }), "error");
