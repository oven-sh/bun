import http from "node:http";
const said = [];
const server = http.createServer((req, res) => {
  Object.defineProperty(req._events, "close", { configurable: true, enumerable: true, get() {
    said.push("look:" + req.closed); process.nextTick(() => said.push("tick:" + req.closed)); return undefined; } });
  req.on("end", () => res.end("ok"));
  req.resume();
});
server.listen(0, async () => {
  const answer = await fetch(`http://localhost:${server.address().port}/`, { method: "POST", body: "a" });
  said.push(await answer.text());
  await new Promise(done => setTimeout(done, 20));
  server.close();
  console.log("SAID " + said.join(" "));
});
