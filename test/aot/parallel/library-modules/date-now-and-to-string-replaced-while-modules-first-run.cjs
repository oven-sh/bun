// Alone: it replaces Date.now and Date.prototype.toString, which the other programs of an executable would then no longer read as constants
// Date.now and Date.prototype.toString are replaced while node:v8 and node:http load for the first time and util.inspect first runs, and are
// put back afterwards. The modules read the engine's clock and print with the engine's function then and later, and never call a replacement.
// The server sends no Date header: that one reads the clock anew for each response.
const stored =
  '{"whileReplaced":{"times":[true,true],"statuses":[200,200,200],"invalid":"Invalid Date"},"afterwards":{"times":[true,true],"statuses":[200,200,200],"invalid":"Invalid Date"},"calls":0}';
const now = Date.now;
const toString = Date.prototype.toString;
let calls = 0;
Date.now = () => (calls++, 5);
Date.prototype.toString = function () {
  calls++;
  return "replaced";
};
const { GCProfiler } = require("node:v8");
const http = require("node:http");
const util = require("node:util");

function times() {
  const profiler = new GCProfiler();
  profiler.start();
  const { startTime, endTime } = profiler.stop();
  return [Math.abs(startTime - now()) < 60_000, Math.abs(endTime - now()) < 60_000];
}

const server = http.createServer((request, response) => {
  response.sendDate = false;
  response.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const get = () =>
    new Promise((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: server.address().port, agent }, response => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        })
        .on("error", reject);
    });
  const round = async () => ({
    times: times(),
    statuses: [await get(), await get(), await get()],
    invalid: util.inspect(new Date(NaN)),
  });
  const whileReplaced = await round();
  Date.now = now;
  Date.prototype.toString = toString;
  const line = JSON.stringify({ whileReplaced, afterwards: await round(), calls });
  console.log(line);
  agent.destroy();
  server.close();
  if (line !== stored) {
    console.log("stored:", stored);
    process.exitCode = 1;
  }
});
