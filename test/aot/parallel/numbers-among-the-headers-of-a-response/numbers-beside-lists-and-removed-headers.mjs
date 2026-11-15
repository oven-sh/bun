// Numbers among the headers of a response beside a list, a header that is removed, one that is set again, and a value that is turned to text by code of the program.
import http from "node:http";
import net from "node:net";

const turns = {
  "every value is a number": res => { for (let i = 0; i < 6; i++) res.setHeader("X-N" + i, i * 3); },
  "a number, then a text under the same name": res => { res.setHeader("X-A", 1); res.setHeader("X-A", "one"); res.setHeader("X-B", "b"); },
  "a text, then a number under the same name": res => { res.setHeader("X-A", "one"); res.setHeader("X-A", 1); res.setHeader("X-B", "b"); },
  "the only number is removed": res => { res.setHeader("X-A", 1); res.setHeader("X-B", "b"); res.removeHeader("X-A"); },
  "every header is removed": res => { res.setHeader("X-A", 1); res.removeHeader("X-A"); },
  "a list beside a number": res => { res.setHeader("X-A", 1); res.setHeader("X-L", ["a", 2]); },
  "a list that a text replaces, beside a number": res => { res.setHeader("X-L", ["a", 2]); res.setHeader("X-A", 1); res.setHeader("X-L", "text"); },
  "an object beside a number": res => { res.setHeader("X-A", 1); res.setHeader("X-O", { toString() { console.log("  toString"); return "made"; } }); },
  "a length that is a number": res => { res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": 2 }); },
  "a length that is a number, behind setHeader": res => { res.setHeader("Content-Length", 2); res.writeHead(201, { "X-A": 4 }); },
  "appended to a number": res => { res.setHeader("X-A", 1); res.appendHeader("X-A", 2); res.setHeader("X-B", 3); },
};
let turn;
const server = http.createServer((req, res) => {
  turns[turn](res);
  console.log(" ", JSON.stringify(res.getHeaders()), JSON.stringify(res.getHeaderNames()));
  res.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

function ask() {
  return new Promise(resolve => {
    let text = "";
    const socket = net.connect(server.address().port, "127.0.0.1", () => socket.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"));
    socket.setEncoding("latin1");
    socket.on("data", chunk => (text += chunk));
    socket.on("close", () => resolve(text));
  });
}

for (turn in turns) {
  console.log(turn);
  const [head, body] = (await ask()).split("\r\n\r\n");
  console.log(" ", head.split("\r\n").filter(line => !/^date:/i.test(line)).join(" | "), "|", JSON.stringify(body));
}
server.close();
