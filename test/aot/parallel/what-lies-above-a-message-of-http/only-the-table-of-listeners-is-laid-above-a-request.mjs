import http from "node:http";
const laid = { made: "up" };
http.IncomingMessage.prototype._events = laid;
const said = [];
const server = http.createServer((req, res) => {
  said.push(Object.hasOwn(req, "_events"), req._events === laid, Object.hasOwn(req, "_eventsCount"), req._eventsCount);
  req.on("data", () => {});
  req.on("end", () => { said.push(req._eventsCount, Object.keys(laid).join()); res.end("ok"); });
});
server.listen(0, async () => {
  for (let i = 0; i < 2; i++) { const answer = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: "abcde" }); said.push(await answer.text()); }
  console.log(said.join(" "));
  server.close();
});
