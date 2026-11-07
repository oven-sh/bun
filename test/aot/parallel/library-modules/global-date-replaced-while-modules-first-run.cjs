// Alone: it replaces the global Date, which the other programs of an executable would then no longer read as a constant
// The global Date is a function without members while node:v8, node:http, node:readline and the mock timers of node:test load for the first
// time and util.inspect first runs, and is put back afterwards. The modules read the engine's clock and the engine's functions of
// Date.prototype then and later, and never call the replacement. The server sends no Date header: that one reads the global Date anew
// for each response.
const stored =
  '{"whileReplaced":{"times":[true,true],"statuses":[200,200,200],"dates":["1970-01-01T00:00:00.000Z","Invalid Date"],"lines":["a","b"],"startTimes":["enabled","ERR_INVALID_ARG_TYPE"]},"afterwards":{"times":[true,true],"statuses":[200,200,200],"dates":["1970-01-01T00:00:00.000Z","Invalid Date"],"lines":["a","b"],"startTimes":["enabled","ERR_INVALID_ARG_TYPE"]},"calls":0}';
const RealDate = Date;
const now = Date.now;
let calls = 0;
globalThis.Date = function () {
  calls++;
};
const { GCProfiler } = require("node:v8");
const http = require("node:http");
const util = require("node:util");
const readline = require("node:readline");
const { mock } = require("node:test");
const { PassThrough } = require("node:stream");

function times() {
  const profiler = new GCProfiler();
  profiler.start();
  const { startTime, endTime } = profiler.stop();
  return [Math.abs(startTime - now()) < 60_000, Math.abs(endTime - now()) < 60_000];
}

// A CR and an LF in two chunks are one line end when the clock that readline reads is not far from the first chunk.
function lines() {
  const input = new PassThrough();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const read = [];
  rl.on("line", line => read.push(line));
  input.emit("data", "a\r");
  input.emit("data", "\nb\n");
  rl.close();
  return read;
}

// The mock timers take the start time of a Date and refuse what is none.
function startTime(start) {
  try {
    mock.timers.enable({ apis: ["setTimeout"], now: start });
    mock.timers.reset();
    return "enabled";
  } catch (error) {
    return error.code;
  }
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
    dates: [util.inspect(new RealDate(0)), util.inspect(new RealDate(NaN))],
    lines: lines(),
    startTimes: [startTime(new RealDate(5000)), startTime({})],
  });
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
