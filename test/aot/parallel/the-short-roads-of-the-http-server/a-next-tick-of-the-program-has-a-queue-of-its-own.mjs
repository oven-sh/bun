// A process.nextTick of the program's own keeps a queue: what the server does "in the next tick" waits its turn in that queue, at the end of the response and of the request.
import http from "node:http";
const real = process.nextTick;
let waiting = [];
function runAll() {
  for (let i = 0; i < waiting.length; i++) { const [fn, args] = waiting[i]; fn(...args); }
  waiting = [];
}
process.nextTick = (fn, ...args) => { if (waiting.push([fn, args]) === 1) real(runAll); };
const agent = new http.Agent({ keepAlive: true });
const server = http.createServer((req, res) => {
  res.on("close", () => process.nextTick(() => console.log("behind close:", req.readableEnded, req.destroyed)));
  res.end("ok");
  process.nextTick(() => console.log("behind end():", res.closed, req.destroyed));
});
let left = 2;
function ask() {
  http.get({ port: server.address().port, host: "127.0.0.1", agent }, answer => {
    answer.resume();
    answer.on("end", () => setTimeout(() => { if (--left) ask(); else { agent.destroy(); server.close(); } }, 20));
  });
}
server.listen(0, "127.0.0.1", ask);
/* Output:
behind end(): false false
behind close: false false
behind end(): false false
behind close: false false
*/
