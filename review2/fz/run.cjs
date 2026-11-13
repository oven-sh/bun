"use strict";
// Runs seeds under several runtimes, K times each, and writes one JSON line per (seed, runtime):
//   { seed, rt, traces: [[line, ...] x K], stderr: [first 400 chars x K] }
// usage: node run.cjs <from> <to> <out.jsonl> [--rt name=path,...] [--k 3] [--par 4] [--gen gen.cjs] [--seeds a,b,c]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i < 0 ? dflt : argv[i + 1];
};
const from = +argv[0],
  to = +argv[1],
  outFile = argv[2];
const rts = opt("rt", "node=/usr/local/bin/node,arm=/tmp/rel/bun-arm")
  .split(",")
  .map(s => s.split("="));
const K = +opt("k", 3);
const PAR = +opt("par", 4);
const TIMEOUT = +opt("timeout", 6000);
const { gen } = require(path.resolve(opt("gen", "/tmp/fz/gen.cjs")));
const genOpts = JSON.parse(opt("genopts", "{}"));
const seedList = opt("seeds", null);
const seeds = seedList ? seedList.split(",").map(Number) : Array.from({ length: to - from }, (_, i) => from + i);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fz-"));

function runOne(rtPath, b64, id) {
  return new Promise(resolve => {
    const out = path.join(tmp, id + ".txt");
    const p = spawn(rtPath, ["/tmp/fz/case.cjs", b64], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, FZ_OUT: out, NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1" },
    });
    let err = "";
    p.stderr.on("data", d => {
      if (err.length < 4000) err += d;
    });
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, TIMEOUT);
    p.on("close", (code, sig) => {
      clearTimeout(t);
      let lines = [];
      try {
        lines = fs.readFileSync(out, "utf8").split("\n").filter(Boolean);
        fs.unlinkSync(out);
      } catch {}
      lines.push(timedOut ? "TIMEOUT" : `status ${code} ${sig}`);
      resolve({ lines, err });
    });
  });
}

const jobs = [];
for (const seed of seeds) for (const [rt, rtPath] of rts) jobs.push({ seed, rt, rtPath });
const outFd = fs.openSync(outFile, "w");
let next = 0,
  done = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    const sc = gen(job.seed, genOpts);
    const b64 = Buffer.from(JSON.stringify(sc)).toString("base64");
    const traces = [],
      stderr = [];
    for (let k = 0; k < K; k++) {
      const { lines, err } = await runOne(job.rtPath, b64, `${job.seed}-${job.rt}-${k}`);
      traces.push(lines);
      stderr.push(err.slice(0, 600));
    }
    fs.writeSync(outFd, JSON.stringify({ seed: job.seed, rt: job.rt, traces, stderr }) + "\n");
    if (++done % 100 === 0) process.stderr.write(`${done}/${jobs.length}\n`);
  }
}
Promise.all(Array.from({ length: PAR }, worker)).then(() => {
  fs.closeSync(outFd);
  fs.rmSync(tmp, { recursive: true, force: true });
});
