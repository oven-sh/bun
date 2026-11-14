// A server makes its requests and responses with classes of the program's: their constructors see how many arguments they are handed and of what kinds, for the first request of a connection and for a later one.
import http from "node:http";
import net from "node:net";

const kind = value => (value === null ? "null" : typeof value === "object" ? value.constructor?.name ?? "object" : typeof value);
const seen = [];
class Request extends http.IncomingMessage {
  constructor(...list) {
    super(...list);
    seen.push("a request of " + list.length + ": " + list.map(kind).join(" "));
  }
}
class Response extends http.ServerResponse {
  constructor(...list) {
    super(...list);
    seen.push("a response of " + list.length + ": " + list.map(kind).join(" "));
  }
}
console.log("lengths:", http.IncomingMessage.length, http.ServerResponse.length, http.OutgoingMessage.length, http.ClientRequest.length);
const server = http.createServer({ IncomingMessage: Request, ServerResponse: Response }, (req, res) => res.end("ok"));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const client = net.connect(server.address().port, "127.0.0.1");
client.setEncoding("latin1");
let arrived = "";
let whole = () => {};
client.on("data", part => {
  arrived += part;
  if (arrived.endsWith("ok")) whole();
});
for (let i = 0; i < 2; i++) {
  arrived = "";
  await new Promise(resolve => {
    whole = resolve;
    client.write(i ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 1\r\n\r\nx" : "GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  });
}
console.log(seen.join("\n"));
client.destroy();
server.close();
