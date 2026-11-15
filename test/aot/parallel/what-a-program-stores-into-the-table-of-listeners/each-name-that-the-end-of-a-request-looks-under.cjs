const http = require("node:http");
const net = require("node:net");
const names = ["", "close", "end", "readable", "resume", "data", "removeListener", "error", "pause"];
const said = [];
let turn = 0;
const server = http.createServer((req, res) => {
  const name = names[turn++];
  const row = [name || "nothing"];
  said.push(row);
  if (name) {
    req._events[name] = function heard() {
      row.push("called");
    };
  }
  res.end("ok");
  setTimeout(() => row.push(`count ${req._eventsCount}`, `left ${typeof req._events[name]}`), 20);
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let asked = 0;
  const ask = () => {
    asked++;
    client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  };
  client.on("data", () => {
    clearTimeout(client.timer);
    client.timer = setTimeout(() => {
      if (asked < names.length) return ask();
      for (const row of said) console.log(row.join(" . "));
      client.destroy();
      server.close();
    }, 60);
  });
  ask();
});
