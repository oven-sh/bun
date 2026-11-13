// The first line of each answer as it goes over the wire, and what the response holds behind it.
import http from "node:http";
import net from "node:net";

const rows = {
  "nothing said": () => {},
  "OK stored": res => { res.statusMessage = "OK"; },
  "Fine stored": res => { res.statusMessage = "Fine"; },
  "ok in small letters": res => { res.statusMessage = "ok"; },
  "OK and a blank": res => { res.statusMessage = "OK "; },
  "an empty text": res => { res.statusMessage = ""; },
  "OK made at run time": res => { res.statusMessage = ["O", "K"].join(""); },
  "OK as an object": res => { res.statusMessage = { toString() { return "OK"; } }; },
  "a number": res => { res.statusMessage = 7; },
  "OK beside 201": res => { res.statusCode = 201; res.statusMessage = "OK"; },
  "OK beside 404": res => { res.statusCode = 404; res.statusMessage = "OK"; },
  "Created beside 200": res => { res.statusMessage = "Created"; },
  "200 as a text": res => { res.statusCode = "200"; },
  "writeHead with OK": res => { res.writeHead(200, "OK"); },
  "writeHead with Fine": res => { res.writeHead(200, "Fine"); },
  "writeHead without a text": res => { res.writeHead(200); },
  "writeHead 299": res => { res.writeHead(299); },
  "an accessor that says OK": res => { Object.defineProperty(res, "statusMessage", { configurable: true, get() { return "OK"; }, set() {} }); },
  "an accessor that says Fine": res => { Object.defineProperty(res, "statusMessage", { configurable: true, get() { return "Fine"; }, set() {} }); },
  "the table of texts changed": res => { http.STATUS_CODES[200] = "Well"; res.on("finish", () => { http.STATUS_CODES[200] = "OK"; }); },
};
let act = () => {};
let held = "";
const server = http.createServer((req, res) => {
  try {
    act(res);
    res.end("x");
  } catch (error) {
    held = "throws " + (error.code ?? error.name);
    res.destroy();
    return;
  }
  held = String(res.statusCode) + " " + String(res.statusMessage);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const ask = () => new Promise(done => {
  const socket = net.connect(server.address().port, "127.0.0.1");
  let got = "";
  const limit = setTimeout(() => socket.destroy(), 500);
  socket.on("data", chunk => { got += chunk.toString("latin1"); if (got.includes("\r\n\r\n")) socket.destroy(); });
  socket.on("close", () => { clearTimeout(limit); done(got.split("\r\n")[0]); });
  socket.on("error", () => {});
  socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
});
for (const name in rows) {
  act = rows[name];
  const line = await ask();
  console.log(name + ": " + JSON.stringify(line) + " | " + held);
}
server.close();
server.closeAllConnections();
