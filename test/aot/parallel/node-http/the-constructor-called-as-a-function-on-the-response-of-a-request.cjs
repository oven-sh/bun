// A handler calls http.ServerResponse as a plain function on the response that it was handed, which lays every field anew, and then ends it. The client is answered as in plain.
const http = require("node:http");
const rows = {
  "/bare": (req, res) => http.ServerResponse.call(res, req),
  "/options": (req, res) => http.ServerResponse.call(res, req, { highWaterMark: 1 }),
  "/headers-first": (req, res) => { res.setHeader("x-laid", "1"); res.statusCode = 201; http.ServerResponse.call(res, req); },
  "/twice": (req, res) => { http.ServerResponse.call(res, req); http.ServerResponse.call(res, req); },
  "/later": (req, res) => { http.ServerResponse.call(res, req); return "later"; },
  "/written-first": (req, res) => { res.write("a"); http.ServerResponse.call(res, req); },
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
