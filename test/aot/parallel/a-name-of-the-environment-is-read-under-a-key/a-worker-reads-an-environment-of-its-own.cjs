const { Worker, isMainThread, parentPort } = require("node:worker_threads");
function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
if (isMainThread) {
  process.env.MADE_UP_FLAG = "of-the-main-thread"; const flag = kept("MADE_UP_FLAG", parser);
  for (let t = 0; t < 5; t++) said.push(flag());
  const worker = new Worker(__filename, { env: { MADE_UP_FLAG: "of-the-worker", MADE_UP_OTHER: "other" } });
  worker.on("message", text => said.push(text));
  worker.on("exit", () => { for (let t = 0; t < 5; t++) said.push(flag()); console.log(said.join(" "), parses); });
} else {
  const flag = kept("MADE_UP_FLAG", parser), other = kept("MADE_UP_OTHER", parser), home = kept("HOME", parser);
  for (let t = 0; t < 12; t++) { if (t === 4) process.env.MADE_UP_FLAG = "stored-in-the-worker"; if (t === 8) delete process.env.MADE_UP_OTHER; said.push(flag(), other(), home()); }
  parentPort.postMessage(said.join(" ") + " " + parses);
}
