// A spread and Object.assign lay the copy in the order in which the source was laid, symbols among the names, and the printer shows that order. The messages of node:http hold some of their state under symbols.
import http from "node:http";

const keysShown = text => [...text.matchAll(/^  (\[?[A-Za-z_$][\w$]*(?:\([^)]*\))?\]?):/gm)].map(match => match[1]).join(" ");
const printed = object => keysShown(Bun.inspect(object, { depth: 0 }));
const message = new http.OutgoingMessage();
message.setHeader("X-One", "1");
console.log("a message:", printed({ ...message }), "|", printed(Object.assign({}, message)));
const { outputData, ...rest } = message;
console.log("all but one:", printed(rest));
const server = http.createServer((req, res) => {
  res.setHeader("X-One", "1");
  console.log(req.url, "the request:", printed({ ...req }), "|", printed(Object.assign({}, req)));
  console.log(req.url, "the response:", printed({ ...res }), "|", printed(Object.assign({}, res)));
  console.log(req.url, "the socket:", printed({ ...req.socket }), "|", printed(Object.assign({}, req.socket)));
  const headers = Object.getOwnPropertySymbols(res).find(symbol => symbol.description === "kOutHeaders");
  console.log(req.url, "the headers of the copy:", JSON.stringify({ ...res }[headers]), JSON.stringify(Object.assign({}, res)[headers]));
  res.end("b");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
console.log(await (await fetch(url + "/first")).text());
console.log(await (await fetch(url + "/second")).text());
server.close();
