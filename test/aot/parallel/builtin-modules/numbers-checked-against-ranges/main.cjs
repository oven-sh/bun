// Functions of node:* that check a number of the caller's against a range, each with every number of the list. It prints the calls that answer otherwise than Node does, and how many it made.
const asNode = require("./as-node-checks.cjs");
const dns = require("node:dns");
const events = require("node:events");
const http = require("node:http");
const { createHistogram, monitorEventLoopDelay } = require("node:perf_hooks");
const { createInterface } = require("node:readline");
const { Readline } = require("node:readline/promises");
const stream = require("node:stream");
const util = require("node:util");

const nowhere = new stream.Writable({ write() {} });
const highWaterMark = stream.getDefaultHighWaterMark(false);

// [the name in the error, the validator, its operands behind the name, the call]
const checks = [
  ["options.lowest", "validateInteger", [1, Number.MAX_SAFE_INTEGER], lowest => createHistogram({ lowest })],
  // The lower end is twice `lowest`, which lies above the upper end from 2 ** 52 on.
  ...[1, 2, 100, 2 ** 31, 2 ** 52 - 1, 2 ** 52, 2 ** 52 + 1, Number.MAX_SAFE_INTEGER].map(lowest => [
    "options.highest",
    "validateInteger",
    [2 * lowest, Number.MAX_SAFE_INTEGER],
    highest => createHistogram({ lowest, highest }),
  ]),
  ["options.figures", "validateInteger", [1, 5], figures => createHistogram({ figures })],
  ["options.resolution", "validateInteger", [1], resolution => monitorEventLoopDelay({ resolution })],
  ["frameCount", "validateInteger", [1, 200], frameCount => util.getCallSites(frameCount)],
  ["value", "validateInteger", [0], value => stream.setDefaultHighWaterMark(false, value)],
  [
    "options.highWaterMark",
    "validateInteger",
    [1],
    highWaterMark => events.on(new events.EventEmitter(), "event", { highWaterMark }),
  ],
  [
    "options.lowWaterMark",
    "validateInteger",
    [1],
    lowWaterMark => events.on(new events.EventEmitter(), "event", { lowWaterMark }),
  ],
  ["dir", "validateInteger", [-1, 1], dir => new Readline(nowhere).clearLine(dir)],
  ["x", "validateInteger", [], x => new Readline(nowhere).cursorTo(x)],
  ["y", "validateInteger", [], y => new Readline(nowhere).cursorTo(0, y)],
  ["dx", "validateInteger", [], dx => new Readline(nowhere).moveCursor(dx, 1)],
  ["dy", "validateInteger", [], dy => new Readline(nowhere).moveCursor(1, dy)],
  ["max", "validateInteger", [1], max => http.setMaxIdleHTTPParsers(max)],
  ["options.timeout", "validateInt32", [-1], timeout => new dns.Resolver({ timeout })],
  ["options.tries", "validateInt32", [1], tries => new dns.Resolver({ tries })],
  [
    "tabSize",
    "validateUint32",
    [true],
    tabSize => createInterface({ input: new stream.PassThrough(), tabSize }).close(),
  ],
  ["setMaxListeners", "validateNumber", [0], n => new events.EventEmitter().setMaxListeners(n)],
  ["defaultMaxListeners", "validateNumber", [0], n => (events.defaultMaxListeners = n)],
  ["maxTotalSockets", "validateNumber", [1], maxTotalSockets => new http.Agent({ maxTotalSockets })],
];

let calls = 0;
for (const [name, validator, operands, call] of checks) {
  for (const value of asNode.numbers) {
    calls++;
    const expected = asNode[validator](value, ...operands);
    const answer = asNode.answerOf(() => call(value), name);
    if (answer !== expected)
      console.log(
        `${name} ${validator}(${[value, ...operands].map(asNode.show).join(", ")}): ${answer}, in Node: ${expected}`,
      );
  }
}
stream.setDefaultHighWaterMark(false, highWaterMark);
events.defaultMaxListeners = 10;
console.log(`${calls} calls`);
