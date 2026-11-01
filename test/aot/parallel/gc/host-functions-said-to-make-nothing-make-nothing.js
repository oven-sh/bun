// The table says of these functions of Bun that they make no object and no string. Each is called thousands of times while an allocation
// that finds no free cell at hand collects, so one that made anything would have a collection inside it, and the checks of the run time say so.
// That they do: a loop over os.hostname(), which makes one string a call, built with --aot-sabotage=NoCallCollects, is reported at that call
// once about 500 calls have used up the free cells.
// Flags: --aot-validate
// Env of the executable: BUN_JSC_validateAOTRuntime=1
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=2
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { monitorEventLoopDelay } = require("node:perf_hooks");

const turns = 4000;
let failures = 0;
function expect(name, holds) {
  if (!holds) {
    failures++;
    console.log("wrong:", name);
  }
}

function clocks() {
  let last = 0;
  let inOrder = true;
  for (let turn = 0; turn < turns; turn++) {
    const now = performance.now();
    if (now < last) inOrder = false;
    last = now;
  }
  expect("performance.now", inOrder);
  last = 0;
  for (let turn = 0; turn < turns; turn++) {
    const now = Bun.nanoseconds();
    if (now < last) inOrder = false;
    last = now;
  }
  expect("Bun.nanoseconds", inOrder);
}

function machine() {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += os.uptime() > 0 ? 1 : 0;
  expect("os.uptime", sum === turns);
  sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += os.freemem() > 0 ? 1 : 0;
  expect("os.freemem", sum === turns);
  sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += os.totalmem() > 0 ? 1 : 0;
  expect("os.totalmem", sum === turns);
}

// A string that is joined and never read stays in its parts, and a piece of a long one points into it.
function paths(head, tail, wide) {
  let absolute = 0;
  for (let turn = 0; turn < turns; turn++) {
    const joined = head + turn + tail;
    if (path.posix.isAbsolute(joined)) absolute++;
  }
  expect("isAbsolute of a joined string", absolute === turns);
  absolute = 0;
  for (let turn = 0; turn < turns; turn++) {
    const joined = wide + turn + tail;
    if (path.posix.isAbsolute(joined)) absolute++;
  }
  expect("isAbsolute of a joined string of wide characters", absolute === 0);
  const long = (head + tail).repeat(40);
  absolute = 0;
  for (let turn = 0; turn < turns; turn++) {
    const piece = long.substring(turn % 7 === 0 ? 0 : 1, 200);
    if (path.posix.isAbsolute(piece)) absolute++;
  }
  expect("isAbsolute of a piece", absolute === Math.ceil(turns / 7));
}

function addresses(origin, name) {
  let found = 0;
  for (let turn = 0; turn < turns; turn++) {
    const url = new URL(origin + "/a/" + turn + "?" + name + "=" + turn + "&z=1");
    if (url.pathname.length > 3 && url.searchParams.get(name) === String(turn) && url.searchParams.has("z")) found++;
  }
  expect("a URL from a joined string", found === turns);
  found = 0;
  const long = origin + "/b?" + name + "=7&z=1#" + "x".repeat(300);
  for (let turn = 0; turn < turns; turn++) {
    const url = new URL(long.substring(0, long.length - (turn % 250)));
    if (url.searchParams.get(name) === "7") found++;
  }
  expect("a URL from a piece", found === turns);
}

function bodies() {
  const blob = new Blob(["abc", "defg"]);
  const file = Bun.file(process.execPath);
  const response = new Response("x", { status: 201 });
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += blob.size;
  expect("Blob.size", sum === 7 * turns);
  sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += file.size > 0 ? 1 : 0;
  expect("the size of a file", sum === turns);
  sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += response.status + (response.ok ? 1 : 0) + (response.redirected ? 1 : 0);
  expect("Response.status, ok, redirected", sum === 202 * turns);
}

function settings() {
  const before = net.getDefaultAutoSelectFamily();
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    net.setDefaultAutoSelectFamily((turn & 1) === 0);
    sum += net.getDefaultAutoSelectFamily() ? 1 : 0;
    sum += net.getDefaultAutoSelectFamilyAttemptTimeout() > 0 ? 1 : 0;
  }
  net.setDefaultAutoSelectFamily(before);
  expect("the settings of node:net", sum === turns + turns / 2);
  sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += http.maxHeaderSize > 0 ? 1 : 0;
  expect("http.maxHeaderSize", sum === turns);
  const list = new net.BlockList();
  const other = { list };
  sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += (net.BlockList.isBlockList(list) ? 1 : 0) + (net.BlockList.isBlockList(other) ? 2 : 0);
  expect("BlockList.isBlockList", sum === turns);
  const delay = monitorEventLoopDelay();
  sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += delay.disable() ? 1 : 0;
  expect("disable() of what was never enabled", sum === 0);
}

async function sockets() {
  const socket = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1" });
  for (let turn = 0; turn < turns; turn++) {
    socket.unref();
    socket.ref();
  }
  for (let turn = 0; turn < turns; turn++) socket.close();
  expect("a closed socket", socket.closed);
}

clocks();
machine();
paths("/usr/", "/bin", "中文");
addresses("http://example.com", "q");
bodies();
settings();
await sockets();
console.log(failures === 0 ? "every answer is right" : failures + " wrong");
