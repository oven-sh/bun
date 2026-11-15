// The server lays a listener of 'close' on each connection and notes under a private symbol that it has. A handler takes both away and ends its response:
// at the next request on that connection the server looks again and lays them anew.
const http = require("node:http");
const net = require("node:net");
const said = [];
let n = 0;
const server = http.createServer((req, res) => {
  const socket = req.socket;
  const mark = Object.getOwnPropertySymbols(socket).find(each => each.description === "kStopParsingOnCloseListener");
  said.push("request " + ++n + ": noted " + socket[mark] + " . listeners of close " + socket.listenerCount("close"));
  if (n === 1) {
    socket.removeAllListeners("close");
    socket[mark] = false;
  }
  res.end("x");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  let answers = 0;
  client.on("data", () => {
    if (++answers < 3) return void setTimeout(ask, 10);
    console.log(said.join("\n"));
    client.destroy();
    server.close();
  });
  ask();
});
