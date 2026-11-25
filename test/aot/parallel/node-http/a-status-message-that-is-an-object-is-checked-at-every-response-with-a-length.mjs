// A status message that is an object is checked at every response. Here: writeHead() with a length, then end() with a body.
import http from "node:http";
import net from "node:net";

const serve = handler =>
  new Promise(done => {
    const server = http.createServer(handler).listen(0, "127.0.0.1", () => done(server));
  });
const ask = server =>
  new Promise(done => {
    let text = "";
    net.connect(server.address().port, "127.0.0.1", function () {
      this.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
      this.setEncoding("latin1");
      this.on("data", data => (text += data));
      this.on("close", () => done(text));
      this.on("error", () => done(text + "<reset>"));
    });
  });
const code = step => {
  try {
    step();
    return "ok";
  } catch (error) {
    return error.code ?? error.name;
  }
};
let turn = 0;
let reads = 0;
const told = [];
const message = {
  toString() {
    reads++;
    return turn === 1 ? "Odd\r\nShelf: 1" : "Fine" + turn;
  },
};
process.on("uncaughtException", error => told.push("uncaught " + (error.code ?? error.name)));
const server = await serve((request, response) => {
  response.statusMessage = message;
  told.push(code(() => response.writeHead(200, { "Content-Length": 1 })));
  told.push(code(() => response.end("x")));
  if (!response.writableEnded) {
    response.statusMessage = "OK";
    response.end();
  }
});
for (turn = 0; turn < 3; turn++) {
  const answer = await ask(server);
  told.push(JSON.stringify(answer.split("\r\n")[0]), /\r\nShelf: 1/.test(answer) ? "with a line more" : "no line more");
}
console.log(told.join(" | "), "| reads", reads);
server.close();
setTimeout(() => process.exit(0), 50);
