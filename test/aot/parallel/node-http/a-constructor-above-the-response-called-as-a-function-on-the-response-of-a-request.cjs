// A handler calls a constructor that stands above http.ServerResponse as a plain function on the response that it was handed, which lays that constructor's fields anew, and then ends it.
// The client is answered as in plain.
const http = require("node:http");
const rows = {
  "/outgoing": (req, res) => http.OutgoingMessage.call(res),
  "/outgoing-options": (req, res) => http.OutgoingMessage.call(res, { highWaterMark: 1 }),
  "/outgoing-headers-first": (req, res) => { res.setHeader("x-laid", "1"); res.statusCode = 201; http.OutgoingMessage.call(res); },
  "/outgoing-twice": (req, res) => { http.OutgoingMessage.call(res); http.OutgoingMessage.call(res); },
  "/outgoing-later": (req, res) => { http.OutgoingMessage.call(res); return "later"; },
  "/outgoing-written-first": (req, res) => { res.write("a"); http.OutgoingMessage.call(res); },
  "/outgoing-then-the-response's": (req, res) => { http.OutgoingMessage.call(res); http.ServerResponse.call(res, req); },
  "/stream": (req, res) => require("node:stream").Stream.call(res),
  "/emitter": (req, res) => require("node:events").call(res),
};
class Asked extends http.IncomingMessage {}
class Answered extends http.ServerResponse {}
const kinds = { "the library's classes": {}, "a request class of the program's": { IncomingMessage: Asked }, "a response class of the program's": { ServerResponse: Answered } };
const serve = (kind, options) => new Promise(done => {
const server = http.createServer(options, (req, res) => {
  let said = "called";
  let when;
  try { when = rows[req.url](req, res); } catch (error) { said = "threw " + error.name; }
  console.log(kind + " " + req.url + " | " + said + " . statusCode " + res.statusCode + " . finished " + res.finished + " . x-laid " + res.getHeader("x-laid"));
  if (when === "later") setTimeout(() => res.end("ok"), 20);
  else res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  for (const path of Object.keys(rows)) {
    const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 1500);
    try { const answer = await fetch("http://127.0.0.1:" + server.address().port + path, { signal: stop.signal }); console.log(kind + " " + path + " | answered " + answer.status + " " + (await answer.text())); } catch (error) { console.log(kind + " " + path + " | NO ANSWER: " + error.name); }
    clearTimeout(timer);
  }
  server.close(done);
  server.closeAllConnections();
});
});
process.on("uncaughtException", error => console.log("uncaught | " + error.name + ": " + String(error.message).slice(0, 70)));
(async () => { for (const [kind, options] of Object.entries(kinds)) await serve(kind, options); })();
