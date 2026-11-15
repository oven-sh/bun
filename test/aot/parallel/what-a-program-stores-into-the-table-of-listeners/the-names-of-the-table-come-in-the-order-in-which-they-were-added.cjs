// The table of listeners of a request is born with five names. Names that are added later come behind them in the order in which they were added, whoever added them and however.
const http = require("node:http");
const net = require("node:net");
const orders = [
  ["aborted", "resume", "pause"],
  ["pause", "resume", "aborted"],
  ["resume", "made-up", "aborted", "removeListener"],
  ["removeListener", "newListener", "aborted"],
  ["data", "aborted", "end", "pause", "close"],
];
const said = [];
let turn = 0;
const server = http.createServer((req, res) => {
  const order = orders[turn % orders.length];
  const direct = turn >= orders.length;
  turn++;
  const nothing = () => {};
  for (const name of order) {
    if (direct) req._events[name] = nothing;
    else if (name !== "data") req.on(name, nothing);
  }
  said.push(`${direct ? "stored" : "added"} ${order.join()}: keys ${Object.keys(req._events).join()} . names ${req.eventNames().join()} . count ${req._eventsCount}`);
  for (const name of order) if (!direct && name !== "data") req.removeListener(name, nothing);
  said.push(`  behind the removals: keys ${Object.keys(req._events).join()} . names ${req.eventNames().join()} . count ${req._eventsCount}`);
  if (direct) for (const name of order) req._events[name] = undefined;
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let asked = 0;
  let timer;
  const ask = () => {
    asked++;
    client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  };
  client.on("data", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (asked < orders.length * 2) return ask();
      for (const line of said) console.log(line);
      client.destroy();
      server.close();
    }, 40);
  });
  ask();
});
