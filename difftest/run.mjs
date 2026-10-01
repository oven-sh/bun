// Runs one case with the current binary: argv = caseDir, scratchDir, mode ("default" | "glob")
// Prints one JSON line: { result, tree, outside } where tree lists every path under
// the scratch dir with type, mode, link target and content.
import { lstatSync, readdirSync, readlinkSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [caseDir, scratch, mode] = process.argv.slice(2);
process.chdir(scratch);
// DIFF_UMASK (octal) sets the umask of the extraction. Mode drift hides under 022.
if (process.env.DIFF_UMASK) process.umask(parseInt(process.env.DIFF_UMASK, 8));

let result;
try {
  const bytes = await Bun.file(join(caseDir, "a.tar")).bytes();
  const archive = new Bun.Archive(bytes);
  const n = mode === "glob" ? await archive.extract("out", { glob: "**" }) : await archive.extract("out");
  result = "count=" + n;
} catch (e) {
  result = "rejected:" + (e?.code ?? e?.name ?? "Error");
}

function walk(dir, rel, acc) {
  let names;
  try {
    names = readdirSync(dir).sort();
  } catch (e) {
    acc.push(rel + "/ <unreadable:" + e.code + ">");
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    const r = rel ? rel + "/" + name : name;
    const st = lstatSync(p);
    const perm = (st.mode & 0o7777).toString(8);
    if (st.isSymbolicLink()) acc.push(`${r} -> ${readlinkSync(p)}`);
    else if (st.isDirectory()) {
      acc.push(`${r}/ ${perm}`);
      walk(p, r, acc);
    } else if (st.isFile()) {
      let content;
      try {
        content = readFileSync(p, "latin1").slice(0, 24);
      } catch (e) {
        content = "<" + e.code + ">";
      }
      acc.push(`${r} ${perm} nlink=${st.nlink} ${JSON.stringify(content)}`);
    } else acc.push(`${r} <special>`);
  }
}
const tree = [];
if (existsSync(scratch)) walk(scratch, "", tree);
console.log(JSON.stringify({ result, tree }));
