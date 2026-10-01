// How near the syntax errors of Bun's parser are to the oracle: positions of the first section against what `bun --lint` printed.
import { openCorpus } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner";
import { parsePlainDiagnostics } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner/tsc_plain_format";
const corpus = openCorpus("/tmp/dcc-scratch/test/cli/lint/conformance/corpus");
const recs = new Map<string, any>((await Bun.file("raw-release-full.jsonl").text()).split("\n").filter(l => l !== "").map(l => JSON.parse(l)).map(r => [r.name, r]));
const table = new Set([1002, 1003, 1005, 1010, 1109, 1110, 1128, 1131, 1160, 1359, 1385, 1386, 1387, 1388]);
const firstSection = (bytes: Uint8Array) => {
  const text = Buffer.from(bytes).toString("utf8");
  if (text.startsWith("\x1b[")) return undefined;
  const lines = text.split("\r\n");
  let end = lines.findIndex(l => l.startsWith("!!! ") || /^==== .* \(\d+ errors\) ====$/s.test(l));
  if (end < 0) end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  const top = lines.slice(0, end).map(l => l.replace(/^(lib.*\.d\.ts)\(--,--\)/i, "$1(1,1)") + "\n").join("");
  const parsed = parsePlainDiagnostics(top);
  return parsed.ok ? parsed.diagnostics : undefined;
};
const base = (p: string | undefined) => (p === undefined ? "" : p.slice(p.lastIndexOf("/") + 1));
let E = 0, unread = 0, pretty = 0;
let allTable = 0, oneDiag = 0, oneDiagTable = 0;
let bunSyntax = 0, firstSamePlace = 0, firstSamePlaceTable = 0;
let candidates = 0, candidatesOne = 0;
let oracleHasTable = 0, oracleHasTableBunSilent = 0;
let withRelatedOrLength = 0;
const exampleNear: string[] = [], exampleFar: string[] = [];
for (const i of corpus.enumerateInstances()) {
  if (i.status !== "run" || i.oracle.class !== "E") continue;
  E++;
  const bytes = corpus.oracle(i);
  const oracle = firstSection(bytes);
  if (oracle === undefined) { if (Buffer.from(bytes).toString("latin1").startsWith("\x1b[")) pretty++; else unread++; continue; }
  const r = recs.get(i.name);
  const bun = r?.stderr === undefined ? [] : (parsePlainDiagnostics(r.stderr) as any).diagnostics ?? [];
  const bunErrors = bun.filter((d: any) => d.rule === "syntax" && d.category === "error");
  const codes = oracle.map(d => d.code!);
  const isAllTable = codes.every(c => table.has(c));
  if (isAllTable) allTable++;
  if (oracle.length === 1) oneDiag++;
  if (oracle.length === 1 && isAllTable) oneDiagTable++;
  if (codes.some(c => table.has(c))) { oracleHasTable++; if (bunErrors.length === 0) oracleHasTableBunSilent++; }
  if (bunErrors.length > 0) {
    bunSyntax++;
    // Bun prints in the order of the sort; its first error of the parse is the one at the smallest position of the first file that has one.
    const samePlace = (o: any, b: any) => base(o.path) === base(b.path) && o.line === b.line && o.character === b.character;
    const first = bunErrors[0];
    const hit = oracle.find(o => samePlace(o, first));
    if (hit !== undefined) { firstSamePlace++; if (table.has(hit.code!)) firstSamePlaceTable++; }
    if (oracle.length === 1 && isAllTable) {
      candidates++;
      if (bunErrors.length === 1 && samePlace(oracle[0], first)) { candidatesOne++; if (exampleNear.length < 5) exampleNear.push(`${i.name}: oracle ${base(oracle[0].path)}(${oracle[0].line},${oracle[0].character}) TS${oracle[0].code} ${oracle[0].messageText} | bun ${first.messageText}`); }
      else if (exampleFar.length < 5) exampleFar.push(`${i.name}: oracle ${base(oracle[0].path)}(${oracle[0].line},${oracle[0].character}) TS${oracle[0].code} | bun ${bunErrors.length}x first ${base(first.path)}(${first.line},${first.character}) ${first.messageText}`);
    }
  }
}
console.log(JSON.stringify({ E, unread, pretty, oneDiag, allTable, oneDiagTable, oracleHasTable, oracleHasTableBunSilent, bunSyntax, firstSamePlace, firstSamePlaceTable, candidates, candidatesOne }, null, 1));
console.log("near:\n  " + exampleNear.join("\n  "));
console.log("far:\n  " + exampleFar.join("\n  "));
