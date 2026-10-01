// Which snippets does Bun's transpiler accept? usage: bun bunparse.mjs <file.json>...
import fs from "node:fs";
const t = new Bun.Transpiler({ loader: "jsx" });
let total = 0, rejected = 0;
for (const f of process.argv.slice(2)) {
  for (const c of JSON.parse(fs.readFileSync(f, "utf8"))) {
    const code = typeof c === "string" ? c : c.code;
    total++;
    try {
      t.transformSync(code);
    } catch (e) {
      rejected++;
      const msg = (e.errors?.[0]?.message ?? e.message ?? String(e)).split("\n")[0];
      console.log(f + "\t" + JSON.stringify(code) + "\t" + msg);
    }
  }
}
console.log(`total=${total} rejected=${rejected}`);
