// The options that say how the values of headers are held are looked at once, at the first header of a message, whoever lays it:
// here the setHeader(), appendHeader() or setHeaders() of the class above responses, called on the response.
import http from "node:http";
import net from "node:net";

const above = http.OutgoingMessage.prototype;
const firstHeaders = {
  "setHeader of the class above": res => above.setHeader.call(res, "x-one", "1"),
  "appendHeader of the class above": res => above.appendHeader.call(res, "x-one", "1"),
  "setHeaders of the class above": res => above.setHeaders.call(res, new Map([["x-one", "1"]])),
  "setHeader of responses": res => res.setHeader("x-one", "1"),
};
const options = {
  "httpValidation of the response": (res, server) => (res.httpValidation = "relaxed"),
  "insecureHTTPParser of the response": (res, server) => (res.insecureHTTPParser = true),
  "httpValidation of the server": (res, server) => (server.httpValidation = "relaxed"),
  "insecureHTTPParser of the server": (res, server) => (server.insecureHTTPParser = true),
};
const seconds = {
  "setHeader of responses": res => res.setHeader("x-two", "a\u0001b"),
  "setHeader of the class above": res => above.setHeader.call(res, "x-two", "a\u0001b"),
};
let current;
let seen;
const server = http.createServer((req, res) => {
  const [first, option, second] = current;
  firstHeaders[first](res);
  options[option](res, server);
  try {
    seconds[second](res);
    seen = "taken";
  } catch (error) {
    seen = error.code;
  }
  res.end("ok");
  delete server.httpValidation;
  delete server.insecureHTTPParser;
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const client = net.connect(server.address().port, "127.0.0.1");
client.setEncoding("latin1");
let arrived = "";
let whole = () => {};
client.on("data", part => {
  arrived += part;
  if (arrived.endsWith("ok")) whole();
});
for (const first in firstHeaders)
  for (const option in options)
    for (const second in seconds) {
      current = [first, option, second];
      arrived = "";
      await new Promise(resolve => {
        whole = resolve;
        client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      });
      const sent = arrived.split("\r\n").filter(line => line.startsWith("x-"));
      console.log(first, ".", option, ".", second, "|", seen, "|", JSON.stringify(sent));
    }
client.destroy();
server.close();
