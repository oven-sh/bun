// Alone: it replaces the global Date, which the other programs of an executable would then no longer read as a constant
// The global Date is a function without members while node:v8 and node:http load for the first time, and is put back afterwards. Both modules read the engine's clock
// then and later, and never call the replacement. The server sends no Date header: that one reads the global Date anew for each response.
const stored =
  '{"whileReplaced":{"times":[true,true],"statuses":[200,200,200]},"afterwards":{"times":[true,true],"statuses":[200,200,200]},"calls":0}';
const RealDate = Date;
const now = Date.now;
let calls = 0;
globalThis.Date = function () {
  calls++;
};
const { GCProfiler } = require("node:v8");
const http = require("node:http");

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
  const round = async () => ({ times: times(), statuses: [await get(), await get(), await get()] });
  const whileReplaced = await round();
  globalThis.Date = RealDate;
  const line = JSON.stringify({ whileReplaced, afterwards: await round(), calls });
  console.log(line);
  agent.destroy();
  server.close();
  if (line !== stored) {
    console.log("stored:", stored);
    process.exitCode = 1;
  }
});
