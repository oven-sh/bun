import fs from "node:fs";
import { dump } from "./dump-ast.mjs";
import { toGo, print, Stats } from "./togo.mjs";
const base = new Set(fs.readFileSync("/tmp/tsdump/ts-diff-final.txt", "utf8").split("\n").filter(Boolean));
const out = [];
for (const a of fs.readFileSync("ts-units.txt", "utf8").split("\n")) {
  if (!a) continue;
  const eq = a.indexOf("=");
  const name = a.slice(0, eq), path = a.slice(eq + 1);
  const text = fs.readFileSync(path, "utf8");
  const d = dump("/" + name, text, undefined, false, { force: true });
  const parsed = JSON.parse(d.text); parsed.header = parsed;
  const mine = print(toGo(parsed, text, new Stats(), {}), []).join("\n") + "\n";
  const all = fs.readFileSync(`/tmp/tsdump/fout/${name}.tsgo.txt`, "utf8");
  const theirs = all.slice(all.indexOf("\nroot ") + 1);
  if (mine !== theirs && !base.has(name)) {
    const A = theirs.split("\n"), B = mine.split("\n");
    let i = 0; while (i < A.length && A[i] === B[i]) i++;
    out.push(`${name}:${i + 1}\n   go: ${A[i]?.trim()}\n   ts: ${B[i]?.trim()}\n   awaitIdentifierInText=${/\bawait\b/.test(text)}`);
  }
}
console.log(out.length); console.log(out.slice(0, 8).join("\n"));
console.log("all extra diffs mention await:", out.every(x => x.endsWith("true")));
