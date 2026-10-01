// node sweep-list.cjs <repo root> <out prefix> <ts|js>  ->  <prefix>.list (id loader @path) and <prefix>.tsc.tsv
// Every tracked file under test/ and src/js of the kind: the comments as tsc 6.0.2 sees them.
const fs = require("fs");
const { execFileSync } = require("child_process");
const { commentsOf } = require("./oracle-lib.cjs");
const [root, prefix, which] = process.argv.slice(2);
const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "test", "src/js"], { maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean);
const pick = which === "js" ? /\.(js|jsx|mjs|cjs)$/ : /\.(ts|tsx|mts|cts)$/;
const list = [], tsv = [];
let skipped = 0;
for (const file of files) {
  if (!pick.test(file)) continue;
  if (/[\s]/.test(file)) { skipped++; continue; }
  let text;
  try { text = fs.readFileSync(root + "/" + file); } catch { skipped++; continue; }
  // A file that is no UTF-8 reads differently in the two: leave it out.
  const str = text.toString("utf8");
  if (!Buffer.from(str, "utf8").equals(text)) { skipped++; continue; }
  const loader = /\.d\.(ts|mts|cts)$/.test(file) ? "dts" : /\.tsx$/.test(file) ? "tsx" : /\.(ts|mts|cts)$/.test(file) ? "ts" : "jsx";
  let result;
  try { result = commentsOf(loader, str); } catch (e) { skipped++; continue; }
  list.push(`${file} ${loader} @${root}/${file}`);
  tsv.push(`${file}\t${result.diags.length ? "diag " + result.diags.slice(0, 3).join(",") : "ok"}\t${result.leading}\t${result.list.join(",")}`);
}
fs.writeFileSync(prefix + ".list", list.join("\n") + "\n");
fs.writeFileSync(prefix + ".tsc.tsv", tsv.join("\n") + "\n");
console.log(`${list.length} files, ${skipped} skipped -> ${prefix}.list, ${prefix}.tsc.tsv`);
