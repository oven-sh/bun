// Splits TypeScript test case files into units, as internal/testrunner/test_case_parser.go does.
import fs from "node:fs";
import path from "node:path";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const out = "/tmp/tsdump/corpus";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const optionRegex = /^\/{2}\s*@(\w+)\s*:\s*([^\r\n]*)/;
const linkRegex = /^\/{2}\s*@link\s*:\s*([^\r\n]*)\s*->\s*([^\r\n]*)/;
export function makeUnits(code, fileName) {
  const units = [];
  const lines = code.split(/\r?\n/);
  let content = null, name = "";
  for (const line of lines) {
    if (linkRegex.test(line)) continue;
    const m = optionRegex.exec(line);
    if (m) {
      if (m[1].toLowerCase() !== "filename") continue;
      if (name !== "") units.push({ name, content: content ?? "" });
      content = null;
      name = m[2].trim();
    } else {
      content = content === null || content.length === 0 ? line : content + "\n" + line;
    }
  }
  if (units.length === 0 && name === "") name = path.basename(fileName);
  units.push({ name, content: content ?? "" });
  return units;
}
const list = [];
let caseIndex = 0;
const exts = /\.(d\.ts|d\.mts|d\.cts|ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const buf = fs.readFileSync(p);
      let code = buf.toString("utf8");
      if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
        list.push(`# skipped utf16 ${p}`);
        continue;
      }
      if (code.charCodeAt(0) === 0xfeff) code = code.slice(1);
      const idx = caseIndex++;
      let u = 0;
      for (const unit of makeUnits(code, p)) {
        if (!exts.test(unit.name)) continue;
        const flat = `${idx}_${u++}_${unit.name.replace(/^[./\\]+/, "").replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const file = path.join(out, flat);
        fs.writeFileSync(file, unit.content);
        list.push(`${flat}=${file}\t${path.relative(root, p)}`);
      }
    }
  }
}
walk(path.join(root, "compiler"));
walk(path.join(root, "conformance"));
fs.writeFileSync("/tmp/tsdump/corpus.list", list.join("\n") + "\n");
console.log("cases", caseIndex, "units", list.filter(l => !l.startsWith("#")).length);
