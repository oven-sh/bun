// Names that are no names, handed to setHeader() as the first header of a message, behind another, and on a second message of the same course.
import http from "node:http";
import net from "node:net";

const odd = { empty: "", undefined: undefined, null: null, zero: 0, symbol: Symbol("noName"), described: Symbol.for("noName"), object: { toString() { return "X-Made"; } }, list: ["X-A"], space: "a b", fine: "X-Fine" };
let reads = 0;
const server = http.createServer((req, res) => {
  const [, kind, place] = req.url.split("/");
  const say = [];
  const lay = () => {
    try { res.setHeader(odd[kind], "v"); say.push("stored"); } catch (error) { say.push(error.code ?? error.name); }
  };
  reads = 0;
  if (place === "first") lay();
  res.setHeader("X-One", "1");
  if (place === "second") lay();
  res.setHeader("X-Two", "2");
  if (place === "last") lay();
  say.push("leniency read " + reads);
  res.setHeader("X-Said", say.join(","));
  res.setHeader("Content-Length", 0);
  res.end();
});
Object.defineProperty(server, "insecureHTTPParser", { configurable: true, get() { reads++; return undefined; } });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
const ask = path => new Promise(done => {
  const socket = net.connect(port, "127.0.0.1");
  let got = "";
  socket.on("data", chunk => { got += chunk.toString("latin1"); if (got.includes("\r\n\r\n")) socket.destroy(); });
  socket.on("close", () => done(got));
  socket.write("GET " + path + " HTTP/1.1\r\nHost: a\r\n\r\n");
});
const shown = text => text.replace(/Date: [A-Z][^\r]*GMT/g, "Date: <now>").replace(/\r\n/g, " | ");
for (let turn = 0; turn < 2; turn++)
  for (const place of ["first", "second", "last"])
    for (const kind in odd) console.log(turn, place, kind + ": " + shown(await ask("/" + kind + "/" + place)));
server.close();
server.closeAllConnections();
