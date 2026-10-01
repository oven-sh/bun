// <bun under test> ar.mjs [--tsx] <file: one source per line, U+23CE = line break> : A or R and the first message, one line per source
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const loader = args.includes("--tsx") ? "tsx" : args.includes("--js") ? "js" : "ts";
const file = args.find(a => !a.startsWith("--"));
const t = new Bun.Transpiler({ loader });
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line || line.startsWith("# ")) continue;
  const src = line.replaceAll("\u23ce", "\n");
  let v;
  try { t.transformSync(src); v = "A"; } catch (e) { v = "R " + (e.errors?.[0]?.message ?? e.message); }
  console.log(v);
}
