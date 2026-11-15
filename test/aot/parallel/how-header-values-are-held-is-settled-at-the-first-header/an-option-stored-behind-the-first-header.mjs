// Whether a control character is let through in the value of a header hangs on options of the message and of its server. They are looked at once, at the first header of a message:
// what a program stores under one of them behind that header changes nothing for this message.
import http from "node:http";
import net from "node:net";

const firstHeaders = {
  "setHeader": res => res.setHeader("x-one", "1"),
  "setHeader with a number": res => res.setHeader("x-one", 1),
  "setHeader with a list": res => res.setHeader("x-one", ["1", "2"]),
  "appendHeader": res => res.appendHeader("x-one", "1"),
  "setHeaders": res => res.setHeaders(new Map([["x-one", "1"]])),
  "no header": () => {},
  "a header whose name is refused": res => {
    try {
      res.setHeader("x one", "1");
    } catch (error) {
      return error.code;
    }
  },
};
const options = {
  "httpValidation of the response": (res, server) => (res.httpValidation = "relaxed"),
  "insecureHTTPParser of the response": (res, server) => (res.insecureHTTPParser = true),
  "httpValidation of the server": (res, server) => (server.httpValidation = "relaxed"),
  "insecureHTTPParser of the server": (res, server) => (server.insecureHTTPParser = true),
};
let current;
let seen;
const server = http.createServer((req, res) => {
  const [first, option] = current;
  firstHeaders[first](res);
  options[option](res, server);
  try {
    res.setHeader("x-two", "a\u0001b");
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
  for (const option in options) {
    current = [first, option];
    arrived = "";
    await new Promise(resolve => {
      whole = resolve;
      client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
    });
    const sent = arrived.split("\r\n").filter(line => line.startsWith("x-"));
    console.log(first, ".", option, "|", seen, "|", JSON.stringify(sent));
  }
client.destroy();
server.close();
