// A plain value is laid on the prototypes of the messages under the name of a field, ahead of the first request.
import http from "node:http";
const laid = { made: "up" };
http.IncomingMessage.prototype._events = laid;
http.OutgoingMessage.prototype._events = laid;
http.IncomingMessage.prototype._eventsCount = 7;
const said = [];
const server = http.createServer((req, res) => {
  said.push(Object.hasOwn(req, "_events"), req._events === laid, Object.hasOwn(res, "_events"), res._events === laid, req._eventsCount, req.listenerCount("data"), Object.keys(laid).join());
  let size = 0;
  req.on("data", chunk => { size += chunk.length; });
  req.on("end", () => { said.push(size, req.listenerCount("end"), req._eventsCount, Object.keys(laid).join()); res.end("ok"); });
});
server.listen(0, async () => {
  for (let i = 0; i < 3; i++) { const answer = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: "abcde" }); said.push(await answer.text()); }
  console.log(said.join(" "));
  server.close();
});
