// One request and its response at a time on a kept-alive connection to a node:http server in this process:
// what the server does between the bytes of a request and the bytes of its response, plus two trips through the kernel.
import { once } from "node:events";
import { createServer } from "node:http";
import { connect } from "node:net";
import { bench, run } from "../runner.mjs";

const body = JSON.stringify({ id: 1, title: "A title", tags: ["a", "b"], likes: 7 });

const server = createServer((req, res) => {
  if (req.headers.accept === undefined) throw new Error("no Accept");
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "content-length": `${Buffer.byteLength(body)}`,
  });
  res.end(body);
});
await once(server.listen(0, "127.0.0.1"), "listening");

const socket = connect(server.address().port, "127.0.0.1");
await once(socket, "connect");
let answered;
socket.on("data", chunk => {
  // Every response here comes in one piece.
  if (chunk.length < body.length) throw new Error("a response in pieces");
  answered();
});
const roundTrip = request =>
  new Promise(resolve => {
    answered = resolve;
    socket.write(request);
  });

const requestOf = names =>
  Buffer.from(
    `GET /posts/1 HTTP/1.1\r\n${names.map(name => `${name}: ${valueOf[name.toLowerCase()] ?? "1"}`).join("\r\n")}\r\n\r\n`,
  );
const valueOf = {
  host: "127.0.0.1:3000",
  connection: "keep-alive",
  accept: "text/html,application/json",
  "accept-language": "*",
  "sec-fetch-mode": "cors",
  "user-agent": "a client/1.0",
  "accept-encoding": "gzip, deflate, br, zstd",
};
const names = ["Host", "Connection", "Accept", "Accept-Language", "Sec-Fetch-Mode", "User-Agent", "Accept-Encoding"];

const same = requestOf(names);
bench("one kind of client", () => roundTrip(same));

// Many kinds of client, each with the names of the others and some of its own.
const clients = Array.from({ length: 40 }, (_, i) =>
  requestOf([...names, `X-Client-${i}`, ...(i % 3 ? ["Cookie"] : []), ...(i % 5 ? ["Referer"] : [])]),
);
let turn = 0;
bench("40 kinds take turns", () => roundTrip(clients[turn++ % clients.length]));

await run();
socket.destroy();
server.close();
