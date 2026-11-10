import http from "node:http";
const names = ["joinDuplicateHeaders", "maxRequestsPerSocket", "timeout", "rejectNonStandardBodyWrites", "keepAliveTimeout", "requireHostHeader", "headersTimeout", "requestTimeout", "emit"];
const looks = [], said = [];
const lay = holder => { const kept = new Map(); for (const name of names) { const above = name === "emit" ? http.Server.prototype.emit : undefined;
  Object.defineProperty(holder, name, { configurable: true, get() { looks.push(name); return kept.has(name) ? kept.get(name) : above; }, set(value) { kept.set(name, value); } }); } };
class Heir extends http.Server {} lay(Heir.prototype);
const between = Object.create(http.Server.prototype); lay(between);
const makers = { heir: () => new Heir(), link: () => { const kept = http.createServer(), own = {}; for (const name of names) if (Object.hasOwn(kept, name)) { own[name] = kept[name]; delete kept[name]; }
  Object.setPrototypeOf(kept, between); Object.assign(kept, own); return kept; }, born: () => http.createServer() };
for (const [name, make] of Object.entries(makers)) {
  const server = make(); server.on("request", (req, res) => res.end("ok"));
  await new Promise(done => server.listen(0, done));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 }), port = server.address().port;
  const ask = () => new Promise(done => http.get({ port, agent }, res => { res.resume(); res.on("end", done); }));
  await ask(); looks.length = 0; await ask();
  said.push(name + ":" + looks.join(","));
  agent.destroy(); await new Promise(done => server.close(done));
}
console.log("SAID " + said.join(" | "));
