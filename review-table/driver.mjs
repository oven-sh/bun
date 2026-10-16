// Driver of the contract table. Always run with node; spawns the runtime under test for each row.
// usage: node driver.mjs <rt> [filter-substring]      prints one JSON line per row
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rt = process.argv[2];
const filter = process.argv[3] ?? "";
const rowsFile = path.join(import.meta.dirname, "rows.mjs");

const stdio = ["stdout", "stderr"];
const T = [];
const add = (stream, state, seq) => T.push({ stream, state, seq });
const seqAll = ["write x3", "proto.write x3", "write,proto.write,write", "proto.write,write", "write,end(chunk,cb)", "write,write,end(cb)", "write,write('',cb),end(cb)", "write,write,destroy()", "write,write,end(cb),destroy()"];
for (const stream of ["stdout", "stderr", "child.stdin", "worker.stdout"]) {
  for (const state of ["idle", "parked", "failing"]) {
    for (const seq of seqAll) {
      if (state === "failing" && /destroy/.test(seq)) continue;
      add(stream, state, seq);
    }
  }
}
for (const seq of seqAll) add("tty", "idle", seq);
for (const stream of ["net.client", "net.server"]) for (const state of ["idle", "parked", "failing"]) for (const seq of ["write x3", "write,end(chunk,cb)", "write,write,end(cb)", "write,write,destroy()", "write,write,end(cb),destroy()"]) { if (state === "failing" && /destroy/.test(seq)) continue; add(stream, state, seq); }
for (const stream of ["fs.createWriteStream", "PassThrough"]) for (const seq of ["write x3", "write,end(chunk,cb)", "write,write,end(cb)"]) add(stream, "idle", seq);

function runRow({ stream, state, seq }) {
  return new Promise(resolve => {
    const report = path.join(os.tmpdir(), `row-report-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    const env = { ...process.env, REPORT: report, BUN_DEBUG_QUIET_LOGS: "1" };
    let kid;
    const underDriver = stream === "stdout" || stream === "stderr" || stream === "worker.stdout";
    if (stream === "tty") {
      const q = s => "'" + s.replace(/'/g, "'\\''") + "'";
      kid = spawn("script", ["-qfec", [rt, rowsFile, stream, state, seq].map(q).join(" "), "/dev/null"], { env, stdio: ["ignore", "pipe", "pipe"] });
      kid.stdout.resume(); kid.stderr.resume();
    } else {
      kid = spawn(rt, [rowsFile, stream, state, seq], { env, stdio: ["ignore", "pipe", "pipe"] });
      if (underDriver) {
        const data = stream === "stderr" ? kid.stderr : kid.stdout;   // the stream under test
        const signal = stream === "stderr" ? kid.stdout : kid.stderr; // "ready" arrives here
        data.pause();
        let got = "";
        signal.on("data", d => {
          got += d;
          if (!got.includes("ready")) return;
          if (state === "idle") data.resume();
          else if (state === "parked") setTimeout(() => data.resume(), 300);
          else if (state === "failing") setTimeout(() => data.destroy(), 300);
        });
        if (state === "idle") data.resume();
      } else {
        kid.stdout.resume(); kid.stderr.resume();
      }
    }
    const timer = setTimeout(() => kid.kill("SIGKILL"), 12000);
    kid.on("exit", (code, sig) => {
      clearTimeout(timer);
      let data;
      try { data = JSON.parse(fs.readFileSync(report, "utf8")); fs.unlinkSync(report); } catch { data = { ev: ["<no report; exit " + code + " " + sig + ">"] }; }
      resolve({ stream, state, seq, ...data });
    });
  });
}

for (const row of T) {
  const key = `${row.stream} | ${row.state} | ${row.seq}`;
  if (filter && !(filter.startsWith("^") ? key.startsWith(filter.slice(1)) : key.includes(filter))) continue;
  const r = await runRow(row);
  console.log(JSON.stringify({ key, ev: r.ev, left: r.left, ctor: r.ctor, fast: r.fast }));
}
