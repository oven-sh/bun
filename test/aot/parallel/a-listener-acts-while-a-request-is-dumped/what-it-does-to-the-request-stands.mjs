// A response ends while nobody has read the request: the library drops the listeners for `data` and lets the request run dry.
// A listener for `removeListener` runs in the midst of that. What it does to the request stands behind it.
import http from "node:http";
import net from "node:net";

const deeds = {
  "destroys the request": req => req.destroy(),
  "pauses the request": req => req.pause(),
  "resumes the request": req => req.resume(),
  "lays a listener for readable": req => req.on("readable", () => {}),
  "does nothing": () => {},
};
let deed;
let seen = [];
let last;
const server = http.createServer((req, res) => {
  last = req;
  req.prependListener("data", () => seen.push("data"));
  req.on("removeListener", name => {
    seen.push("removed " + String(name));
    deeds[deed](req);
  });
  for (const name of ["close", "end", "error", "aborted", "pause", "resume"]) req.on(name, () => seen.push(name));
  res.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
for (deed in deeds) {
  const client = net.connect(server.address().port, "127.0.0.1");
  client.setEncoding("latin1");
  client.on("error", () => {});
  let arrived = "";
  let whole = () => {};
  client.on("data", part => {
    arrived += part;
    if (arrived.endsWith("ok")) whole();
  });
  client.on("close", () => whole());
  for (let i = 0; i < 2; i++) {
    seen = [];
    arrived = "";
    await new Promise(resolve => {
      whole = resolve;
      client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    const state = last._readableState;
    console.log(deed, "| request", i + 1, "|", arrived.split("\r\n")[0] || "nothing", "|", seen.join(", "));
    console.log("  destroyed", last.destroyed, "ended", last.readableEnded, "flowing", last.readableFlowing, "paused", last.isPaused(), "closed", state.closed, "dumped", last._dumped);
    if (client.destroyed) break;
  }
  client.destroy();
}
server.close();
