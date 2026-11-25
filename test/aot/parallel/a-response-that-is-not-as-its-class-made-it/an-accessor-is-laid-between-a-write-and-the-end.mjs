// write() sends the head, so what is stored under statusCode or statusMessage behind it has no effect on the wire. An accessor of the program's is laid on the response in front of the write or between the write and the end, and the end comes through the response itself, an heir of it or a Proxy over it. The status, the framing and the body that the client gets are as without compilation.
import http from "node:http";
let row = [];
const lay = res => Object.defineProperty(res, "madeUp", { configurable: true, get: () => 1 });
const through = {
  "itself": res => res,
  "an heir": res => Object.create(res),
  "a proxy": res => new Proxy(res, {}),
};
const server = http.createServer((req, res) => {
  const [laid, receiver, head, framing] = row;
  if (framing === "a length") res.setHeader("Content-Length", "2");
  if (head === "writeHead()") res.writeHead(201, "First");
  else res.statusCode = 201;
  if (laid === "in front of the write") lay(res);
  res.write("ab");
  if (laid === "between the write and the end") lay(res);
  res.statusCode = 404;
  res.statusMessage = "Made Up";
  through[receiver](res).end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
for (const laid of ["never", "in front of the write", "between the write and the end"]) {
  for (const receiver of Object.keys(through)) {
    for (const head of ["statusCode", "writeHead()"]) {
      for (const framing of ["a length", "chunks"]) {
        row = [laid, receiver, head, framing];
        const got = await fetch("http://127.0.0.1:" + server.address().port);
        const body = await got.text();
        console.log(
          `${row.join(" . ")}: ${got.status} ${got.statusText} | length ${got.headers.get("content-length")} encoding ${got.headers.get("transfer-encoding")} ${JSON.stringify(body)}`,
        );
      }
    }
  }
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
