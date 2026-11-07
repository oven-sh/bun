// The value of a header is an object of the program's, and its toString() runs while end() or write() makes the head. There it lays an accessor on the response, takes a head of its own or not, and stores another status code and message. What the client gets is as without compilation.
import http from "node:http";
let row = [];
let notes = [];
const server = http.createServer((req, res) => {
  const [call, head, taken, framing] = row;
  let armed = false;
  res.setHeader("x-made-up", {
    toString() {
      if (armed) {
        armed = false;
        Object.defineProperty(res, "madeUp", { configurable: true, get: () => 1 });
        if (taken === "takes a head") {
          try {
            res.writeHead(202, "Second");
          } catch (error) {
            notes.push(error.code);
          }
        }
        res.statusCode = 503;
        res.statusMessage = "Too Late";
      }
      return "v";
    },
  });
  if (framing === "a length") res.setHeader("Content-Length", "4");
  if (head === "writeHead()") res.writeHead(201, "First");
  armed = true;
  try {
    if (call === "end") res.end("body");
    else {
      res.write("bo");
      res.end("dy");
    }
  } catch (error) {
    notes.push("thrown " + error.code);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
for (const call of ["end", "write, end"]) {
  for (const head of ["no head", "writeHead()"]) {
    for (const taken of ["takes a head", "takes none"]) {
      for (const framing of ["a length", "chunks"]) {
        row = [call, head, taken, framing];
        notes = [];
        let seen = "no answer";
        try {
          const got = await fetch("http://127.0.0.1:" + server.address().port, { signal: AbortSignal.timeout(3000) });
          seen = `${got.status} ${got.statusText} | length ${got.headers.get("content-length")} encoding ${got.headers.get("transfer-encoding")} ${JSON.stringify(await got.text())}`;
        } catch {}
        console.log(`${row.join(" . ")}: ${seen} ${notes.join()}`);
      }
    }
  }
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
