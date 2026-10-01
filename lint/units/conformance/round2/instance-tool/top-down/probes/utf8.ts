import { readdirSync, readFileSync } from "node:fs";
const root = "/tmp/conf-it-1b/repo/test/cli/lint/conformance/corpus/baselines";
const dirs = [`${root}/typescript`, `${root}/typescript-go/compiler`, `${root}/typescript-go/conformance`];
let files = 0, invalid = 0, fffd = 0, loneLf = 0, loneCr = 0, noFinal = 0, esc = 0, tab = 0, maxLine = 0, over500 = 0, maxFirst = 0;
const strict = new TextDecoder("utf-8", { fatal: true });
const inv: string[] = [], ff: string[] = [];
for (const d of dirs) for (const n of readdirSync(d)) {
  if (!n.endsWith(".errors.txt")) continue;
  files++;
  const b = readFileSync(`${d}/${n}`);
  let text: string;
  try { text = strict.decode(b); } catch { invalid++; inv.push(n); text = new TextDecoder().decode(b); }
  if (text.includes("\ufffd")) { fffd++; ff.push(n); }
  const lines = text.split("\r\n");
  if (lines.some(l => l.includes("\n"))) loneLf++;
  if (lines.some(l => l.includes("\r"))) loneCr++;
  if (text.includes("\x1b")) esc++;
  if (text.includes("\t")) tab++;
  for (const l of lines) { if (l.length > maxLine) maxLine = l.length; }
  if (lines[0].length > 500) over500++;
  if (lines[0].length > maxFirst) maxFirst = lines[0].length;
}
console.log({ files, invalid, fffd, loneLf, loneCr, esc, tab, maxLine, over500, maxFirst });
console.log("invalid:", inv.slice(0, 10));
console.log("fffd:", ff.slice(0, 10));
