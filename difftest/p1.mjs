import { mkdtempSync, mkdirSync, chmodSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
const base = mkdtempSync(join(tmpdir(), "p1-"));
async function run(label, fn) {
  try { console.log(label, "=> resolved", await fn()); }
  catch (e) { console.log(label, "=> rejected", e?.code ?? "", String(e?.message ?? e).slice(0, 90)); }
}
const long = Buffer.alloc(300, "x").toString();
await run("long parent, default", () => new Bun.Archive({ [long + "/f.txt"]: "F", "ok.txt": "OK" }).extract(join(base, "a")));
await run("long parent, glob   ", () => new Bun.Archive({ [long + "/f.txt"]: "F", "ok.txt": "OK" }).extract(join(base, "b"), { glob: "**" }));
await run("long leaf, default  ", () => new Bun.Archive({ [long]: "F" }).extract(join(base, "c")));
// read-only destination (only meaningful when not root)
const ro = join(base, "ro"); mkdirSync(ro); chmodSync(ro, 0o555);
await run(`uid=${process.getuid()} ro dest nested, default`, () => new Bun.Archive({ "a/f.txt": "F" }).extract(ro));
await run(`uid=${process.getuid()} ro dest nested, glob   `, () => new Bun.Archive({ "a/f.txt": "F" }).extract(ro, { glob: "**" }));
await run(`uid=${process.getuid()} ro dest deeper, default`, () => new Bun.Archive({ "d/e/f.txt": "F" }).extract(ro));
chmodSync(ro, 0o755);
console.log("ro contents:", readdirSync(ro));
