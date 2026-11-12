// An _unrefTimer() of the program's own runs between the look at the class and the birth of the response. It lays an accessor on ServerResponse.prototype, and the response still ends, calls back and finishes.
import http from "node:http";
import net from "node:net";

const server = http.createServer((req, res) => {
  res.on("finish", () => console.log(req.url, "finish", res.writableFinished));
  res.on("close", () => console.log(req.url, "close"));
  console.log(req.url, "laid", res.laidByTheProgram, res.writableFinished);
  res.end("ok", error => console.log(req.url, "callback", error, res.writableFinished));
});
server.on("connection", socket => {
  socket._unrefTimer = function (...args) {
    Object.defineProperty(http.ServerResponse.prototype, "laidByTheProgram", { get: () => "yes", configurable: true });
    return net.Socket.prototype._unrefTimer.apply(this, args);
  };
});
server.listen(0, "127.0.0.1", async () => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  for (const path of ["/first", "/second", "/third"]) {
    const body = await new Promise(resolve =>
      http.get({ host: "127.0.0.1", port: server.address().port, path, agent }, res => {
        let text = "";
        res.setEncoding("utf8").on("data", chunk => (text += chunk));
        res.on("end", () => resolve(text));
      }),
    );
    console.log(path, "body", body);
    delete http.ServerResponse.prototype.laidByTheProgram;
  }
  agent.destroy();
  server.close();
});
