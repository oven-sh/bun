// A program stores a table of its own under `_events` of a request: with the names of the born one, in another order, with a listener in it, above nothing, with a name more.
const http = require("node:http");
const net = require("node:net");
const tables = {
  "the same names": heard => ({ close: undefined, error: undefined, data: undefined, end: undefined, readable: undefined }),
  "another order": heard => ({ readable: undefined, end: undefined, data: undefined, error: undefined, close: undefined }),
  "a listener of close": heard => ({ close: () => heard.push("close"), error: undefined, data: undefined, end: undefined, readable: undefined }),
  "a listener of end": heard => ({ close: undefined, error: undefined, data: undefined, end: () => heard.push("end"), readable: undefined }),
  "above nothing": heard => ({ __proto__: null, close: () => heard.push("close"), error: undefined, data: undefined, end: undefined, readable: undefined }),
  "a name more": heard => ({ close: undefined, error: undefined, data: undefined, end: undefined, readable: undefined, resume: () => heard.push("resume") }),
  "an empty one": heard => ({}),
};
const names = Object.keys(tables);
const said = [];
let turn = 0;
const server = http.createServer((req, res) => {
  const name = names[(turn >> 1) % names.length];
  const reads = turn % 2 === 1;
  turn++;
  const heard = [];
  req._events = tables[name](heard);
  if (reads) {
    req.on("data", () => heard.push("data"));
    req.on("end", () => res.end("ok"));
  } else res.end("ok");
  setTimeout(() => said.push(`${name}, ${reads ? "read" : "untouched"}: heard ${heard.join()} . count ${req._eventsCount} . keys ${Object.keys(req._events).join()}`), 25);
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let asked = 0;
  let timer;
  const ask = () => {
    client.write(asked++ % 2 === 1 ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nab" : "GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  };
  client.on("data", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (asked < names.length * 2) return ask();
      for (const line of said) console.log(line);
      client.destroy();
      server.close();
    }, 60);
  });
  ask();
});
