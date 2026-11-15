// A class below http.IncomingMessage keeps the first argument that the server hands its constructor, and the program hands it on to http.ServerResponse as its options:
// with `new`, as a plain call on a response that exists, and on a frozen one; and likewise the key under which a response keeps its handle. What comes of it is as in plain.
const http = require("node:http");
let kept;
class Asked extends http.IncomingMessage {
  constructor(...given) {
    kept ??= given[0];
    super(...given);
  }
}
const tell = (title, act) => {
  let line;
  try { line = act(); } catch (error) { line = "threw " + error.name + ": " + String(error.message).slice(0, 60); }
  console.log(title + " | " + line);
};
const look = res => "statusCode " + res.statusCode + " . finished " + res.finished + " . socket " + (res.socket === null ? "null" : typeof res.socket) + " . sendDate " + res.sendDate + " . listeners of finish " + res.listenerCount("finish") + " . mark " + res.writableHighWaterMark + " . own " + Reflect.ownKeys(res).length;
const server = http.createServer({ IncomingMessage: Asked }, (req, res) => {
  console.log("handed | " + typeof kept + " " + String(kept));
  tell("new, the kept value as options", () => look(new http.ServerResponse(req, kept)));
  tell("new, then headers and an end", () => { const made = new http.ServerResponse(req, kept); made.setHeader("a", "b"); made.end("x"); return look(made); });
  tell("new, with more arguments behind it", () => look(new http.ServerResponse(req, kept, {}, {}, 1, true, 5, false)));
  tell("new, the key under which a response keeps its handle as options", () => { const key = Object.getOwnPropertySymbols(res).find(symbol => symbol.description === "handle"); return typeof key + " . " + look(new http.ServerResponse(req, key)); });
  tell("a plain call on a response that exists", () => { const made = new http.ServerResponse(req); made.statusCode = 404; http.ServerResponse.call(made, req, kept); return look(made); });
  tell("a plain call on a frozen response", () => { const made = new http.ServerResponse(req); made.statusCode = 404; Object.freeze(made); http.ServerResponse.call(made, req, kept); return look(made); });
  tell("the response of this request still ends", () => { res.end("ok"); return "finished " + res.finished; });
});
server.listen(0, "127.0.0.1", async () => {
  try { const answer = await fetch("http://127.0.0.1:" + server.address().port + "/"); console.log("answered | " + answer.status + " " + (await answer.text())); } catch (error) { console.log("the client | " + error.name); }
  server.close();
  server.closeAllConnections();
});
