const fs = require("fs");
const names = f => { const m = new Map(); for (const l of fs.readFileSync(f, "utf8").split("\n")) { const r = /^\((pass|fail|skip|todo)\) (.*?)( \[[0-9.]+m?s\])?$/.exec(l); if (r) m.set(r[2], r[1]); } return m; };
const old = names("/tmp/probe1/dbg-child_process-oldfile.log"), base = names("/tmp/frame/cp-base.log"), arm = names("/tmp/frame/cp-arm.log");
const added = [...arm.keys()].filter(k => !old.has(k));
const passBase = added.filter(k => base.get(k) === "pass"), failBase = added.filter(k => base.get(k) === "fail");
console.log("tests in old file:", old.size, "| in new file:", arm.size, "| added:", added.length, "| added & pass on base:", passBase.length, "| added & fail on base:", failBase.length, "| other:", added.length - passBase.length - failBase.length);
for (const k of passBase) console.log("  pass-on-base:", k.slice(0, 150));
