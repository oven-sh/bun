"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fzl-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
let uid = 0;
const RT = { node: "/usr/local/bin/node", arm: "/tmp/rel/bun-arm", base: "/tmp/rel/bun-base" };

function runOne(rtPath, sc, timeout = 6000) {
  return new Promise(resolve => {
    const out = path.join(tmp, `${process.pid}-${uid++}.txt`);
    const b64 = Buffer.from(JSON.stringify(sc)).toString("base64");
    const p = spawn(rtPath, ["/tmp/fz/case.cjs", b64], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, FZ_OUT: out, NO_COLOR: "1" } });
    let err = "";
    p.stderr.on("data", d => {
      if (err.length < 4000) err += d;
    });
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, timeout);
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
async function runK(rtPath, sc, k) {
  const out = [];
  for (let i = 0; i < k; i++) out.push((await runOne(rtPath, sc)).lines);
  return out;
}

const HANDLER = /^(out|err) (data|read|iter)#(\d+) (.*)$/;
const MARKER = /^(out|err) (tick|micro)#\d+$/;
function prep(lines, sc, raw) {
  if (raw) return lines;
  if (sc.ue || !lines.includes("process exit 1")) return lines;
  let last = -1;
  lines.forEach((l, i) => {
    if (HANDLER.test(l)) last = i;
  });
  return lines.filter((l, i) => !(i > last && MARKER.test(l)));
}
function rle(s) {
  const runs = [];
  for (const m of s.matchAll(/([A-Za-z])(\d+)/g)) {
    if (runs.length && runs[runs.length - 1][0] === m[1]) runs[runs.length - 1][1] += +m[2];
    else runs.push([m[1], +m[2]]);
  }
  return runs.map(r => r[0] + r[1]).join("");
}
function layers(lines0, sc, raw) {
  const lines = prep(lines0, sc, raw);
  const pp = () => ({ out: 0, err: 0 });
  const o = { bytes: { out: "", err: "" }, calls: pp(), end: pp(), close: pp(), error: { out: "", err: "" }, ue: [], ur: [], childExit: "", childClose: "", procExit: "", status: "" };
  for (const l of lines) {
    let m;
    if ((m = HANDLER.exec(l))) {
      o.bytes[m[1]] += m[4];
      o.calls[m[1]]++;
    } else if ((m = /^(out|err) end$/.exec(l))) o.end[m[1]]++;
    else if ((m = /^(out|err) close$/.exec(l))) o.close[m[1]]++;
    else if ((m = /^(out|err) error (.*)$/.exec(l))) o.error[m[1]] += m[2] + ";";
    else if (l.startsWith("UE ")) o.ue.push(l);
    else if (l.startsWith("UR ")) o.ur.push(l);
    else if (l.startsWith("child exit")) o.childExit += l;
    else if (l.startsWith("child close")) o.childClose += l;
    else if (l.startsWith("process exit")) o.procExit += l;
    else if (l.startsWith("status") || l === "TIMEOUT") o.status = l;
  }
  for (const p of ["out", "err"]) o.bytes[p] = rle(o.bytes[p]);
  o.ue.sort();
  o.ur.sort();
  const L0 = JSON.stringify(o);
  const per = {};
  for (const p of ["out", "err"]) per[p] = lines.filter(l => (l.startsWith(p + " ") && l !== p + " close") || ((l.startsWith("UE ") || l.startsWith("UR ")) && l.includes(`-${p}-`)));
  const L1 = L0 + "\n" + JSON.stringify(per);
  const noClose = lines.filter(l => !/^(out|err) close$/.test(l));
  const L2 = L0 + "\n" + noClose.join("\n");
  const L3 = lines.join("\n");
  return { L0, L1, L2, L3, o, per, lines, noClose };
}
// true if no run of A equals any run of B at layer L
function differs(tracesA, tracesB, sc, L, raw) {
  const sa = new Set(tracesA.map(t => layers(t, sc, raw)[L]));
  return !tracesB.some(t => sa.has(layers(t, sc, raw)[L]));
}
function firstLayer(tracesA, tracesB, sc, raw) {
  for (const L of ["L0", "L1", "L2", "L3"]) if (differs(tracesA, tracesB, sc, L, raw)) return L;
  return null;
}
module.exports = { RT, runOne, runK, layers, differs, firstLayer, HANDLER, MARKER };
