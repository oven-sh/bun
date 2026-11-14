// createServer({ IncomingMessage: Asked }): a class below http.IncomingMessage that defines a list on its own prototype under `rawHeaders`, over the accessor of the library.
// One class and one name a program: what ends a door's yes for one class below ends it for all of them. Quiet: the handler lays no listener and reads nothing.
const http = require("node:http");
const net = require("node:net");

let called = 0;
class Asked extends http.IncomingMessage {}
Object.defineProperty(Asked.prototype, "rawHeaders", { value: ["Host", "made-up"], writable: true, configurable: true });

function ask(port, text, times) {
  return new Promise(resolve => {
    let answers = 0;
    let got = "";
    const client = net.connect(port, "127.0.0.1", () => client.write(text));
    client.on("data", chunk => {
      got += chunk;
      if (!got.endsWith("ok")) return;
      got = "";
      if (++answers < times) client.write(text);
      else client.end();
    });
    client.on("error", () => {});
    client.on("close", () => resolve(answers));
  });
}

async function row(isQuiet, isPost) {
  called = 0;
  const kept = [];
  const heard = [];
  let body = "";
  const server = http.createServer({ IncomingMessage: Asked }, (req, res) => {
    kept.push(req);
    if (isQuiet) return void res.end("ok");
    req.on("data", chunk => (body += chunk));
    req.on("end", () => heard.push("end"));
    req.on("close", () => heard.push("close"));
    if (isPost) req.on("end", () => res.end("ok"));
    else res.end("ok");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const text = isPost ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello" : "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
  const answers = (await ask(server.address().port, text, 2)) + (await ask(server.address().port, text, 1));
  await new Promise(resolve => server.close(resolve));
  const wasCalled = called > 0;
  const flags = kept.map(req => `${req.complete} ${req.destroyed} ${req.readableEnded} ${req.rawHeaders.length} ${req.headers.host} ${req instanceof Asked}`);
  console.log(`${isQuiet ? "quiet" : "heard"} . ${isPost ? "POST" : "GET"} | ${answers} answers . called ${wasCalled} . ${heard.join()} . ${JSON.stringify(body)} | ${flags.join(" | ")}`);
}

(async () => {
  for (const isQuiet of [true, false]) for (const isPost of [false, true]) await row(isQuiet, isPost);
})();
