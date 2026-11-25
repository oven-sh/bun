const http = require("node:http"), net = require("node:net");
const said = [];
const find = (socket, name) => Object.getOwnPropertySymbols(socket).find(each => each.description === name);
const deeds = {
  none: [s => s.listenerCount("close"), () => {}],
  close: [s => s[find(s, "kStopParsingOnCloseListener")] + "/" + s.listenerCount("close"), s => { s.removeAllListeners("close"); s[find(s, "kStopParsingOnCloseListener")] = false; }],
  abortNull: [s => typeof s[find(s, "kBoundOnAbort")], s => { s[find(s, "kBoundOnAbort")] = null; }],
  abortMissing: [s => typeof s[find(s, "kBoundOnAbort")], s => { s[find(s, "kBoundOnAbort")] = undefined; }],
  abortNullBody: [s => typeof s[find(s, "kBoundOnAbort")], s => { s[find(s, "kBoundOnAbort")] = null; }],
  abortMissingBody: [s => typeof s[find(s, "kBoundOnAbort")], s => { s[find(s, "kBoundOnAbort")] = undefined; }],
  parser: [s => s.parser === null, s => { s.parser = null; }],
};
const names = Object.keys(deeds);
const server = http.createServer((req, res) => {
  const [, deed, n] = req.url.split("/"), socket = req.socket;
  try { said.push(deed + n + "=" + deeds[deed][0](socket)); if (n === "1") deeds[deed][1](socket); } catch (e) { said.push(deed + n + "=" + e.name); }
  res.end("x#");
});
server.listen(0, "127.0.0.1", function next() {
  const deed = names.shift();
  if (deed === undefined) { console.log("SAID " + said.join(" ")); server.close(); return; }
  const asks = ["1", "2", "3"].map(n => "/" + deed + "/" + n);
  const client = net.connect(server.address().port, "127.0.0.1"), ask = () => client.write(deed.endsWith("Body") ? "POST " + asks.shift() + " HTTP/1.1\r\nHost: a\r\nContent-Length: 1\r\n\r\nx" : "GET " + asks.shift() + " HTTP/1.1\r\nHost: a\r\n\r\n");
  client.on("connect", ask);
  client.on("data", bytes => { if (!String(bytes).includes("#")) return; if (asks.length) ask(); else client.end(); });
  client.on("close", next);
});
