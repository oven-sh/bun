// A response has one to eight headers, and at each place in turn the value is a number. The head goes over the wire as text, and getHeader() answers with the number.
import http from "node:http";
import net from "node:net";

const numbers = [13, 0, -0, 1.5, -7, 1e21, 2 ** 31, NaN, Infinity];
let count = 1, place = 0, number = 13, byWriteHead = false;
const server = http.createServer((req, res) => {
  const headers = {};
  for (let i = 0; i < count; i++) headers["X-H" + i] = i === place ? number : "text" + i;
  if (byWriteHead) res.writeHead(200, headers);
  else for (const name in headers) res.setHeader(name, headers[name]);
  const before = res.getHeader("x-h" + place);
  res.end("ok");
  const after = res.getHeader("x-h" + place);
  console.log(count, place, byWriteHead ? "writeHead" : "setHeader", typeof before, Object.is(before, number), typeof after, Object.is(after, number));
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

for (byWriteHead of [false, true]) {
  for (count = 1; count <= 8; count++) {
    for (place = 0; place < count; place++) {
      number = numbers[(count + place) % numbers.length];
      const head = (await ask()).split("\r\n\r\n")[0].split("\r\n").filter(line => /^x-h/i.test(line));
      console.log(" ", head.join(" | "));
    }
  }
}
server.close();
