import http from "node:http"; import stream from "node:stream"; import events from "node:events";
function Ask(a, b, c, d, e, f, g, h) { http.IncomingMessage.call(this, a, b, c, d, e, f, g, h); } Object.setPrototypeOf(Ask.prototype, http.IncomingMessage.prototype); Object.setPrototypeOf(Ask, http.IncomingMessage);
function Other(a, b, c, d, e, f, g, h) { http.IncomingMessage.call(this, a, b, c, d, e, f, g, h); } Object.setPrototypeOf(Other.prototype, http.IncomingMessage.prototype); Object.setPrototypeOf(Other, http.IncomingMessage);
let byLibrary = 0, byProgram = 0; const old = new events.EventEmitter(); old.pause = () => {}; old.resume = () => { byLibrary++; old.emit("data", "y"); };
Ask.prototype._readableState = new stream.Readable({ highWaterMark: 0 })._readableState; stream.Readable.prototype.wrap.call(Ask.prototype, old); old.emit("data", "x");
Other.prototype._read = function () { byProgram++; };
async function post(Class) { const server = http.createServer({ IncomingMessage: Class }, (req, res) => { let body = ""; req.on("data", chunk => { body += chunk; }); req.on("end", () => res.end(body)); }); await new Promise(done => server.listen(0, "127.0.0.1", done)); const answer = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: "made up body", signal: AbortSignal.timeout(3000) }).then(it => it.text(), () => "none"); server.close(); server.closeAllConnections(); return answer; }
console.log(await post(Ask), await post(Other), `same ${byLibrary === byProgram}`, byProgram > 0);
