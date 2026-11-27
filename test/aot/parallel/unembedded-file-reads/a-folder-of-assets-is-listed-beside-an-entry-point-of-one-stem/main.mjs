// The folder is an asset: each of its files is listed, also crate.js, whose stem is that of an entry point.
// Flags: --asset ./box
// Entry points: ./box/crate.ts
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const box = join(import.meta.dirname, "box");
const list = names => [...names].sort().join(" ");
console.log(existsSync(join(box, "crate.js")), statSync(join(box, "crate.js")).size > 0);
console.log(list(readdirSync(box)));
console.log(list(readdirSync(box, { recursive: true })));
console.log(list(readdirSync(box, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name)));
console.log(list(new Bun.Glob("*").scanSync({ cwd: box })));
const copy = mkdtempSync(join(tmpdir(), "box-"));
cpSync(box, copy, { recursive: true });
console.log(list(readdirSync(copy)));
console.log((await Bun.file(join(copy, "crate.js")).text()).trim());
rmSync(copy, { recursive: true });
