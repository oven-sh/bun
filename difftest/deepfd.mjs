import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
const depth = Number(process.argv[2] ?? 70);
const deep = Buffer.alloc(depth * 2, "d/").toString();
const out = mkdtempSync(tmpdir() + "/deepfd-");
const r = await new Bun.Archive({ [deep + "f.txt"]: "F", [deep + "g.txt"]: "G", "top.txt": "T" })
  .extract(out).then(n => "resolved " + n, e => "REJECTED " + e.message);
console.log(`depth ${depth}:`, r, "| f exists:", existsSync(out + "/" + deep + "f.txt"), "| top exists:", existsSync(out + "/top.txt"));
