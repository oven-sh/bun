// Holds every line of a file against the forms that the usage names, and counts them.
const text = await Bun.file(process.argv[2]).text();
const lines = text.split("\n");
if (lines.pop() !== "") throw new Error("no line feed at the end");
const forms = new Map<string, number>();
const add = (k: string) => forms.set(k, (forms.get(k) ?? 0) + 1);
let longest = 0;
let control = 0;
let nonAscii = 0;
const samples: Record<string, string> = {};
for (const line of lines) {
  longest = Math.max(longest, line.length);
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(line)) control++;
  if (/[^\x00-\x7f]/.test(line)) nonAscii++;
  const m = /^(pass|fail|skip|provisional|unavailable|unsupported|crash|timeout) ([^ ]+)(?: (.*))?$/s.exec(line);
  if (m === null) {
    add("NO FORM");
    samples["NO FORM"] ??= line;
    continue;
  }
  const [, outcome, , detail] = m;
  if (detail === undefined) {
    add(`${outcome}`);
    continue;
  }
  const d = /^line ([0-9]+):(?: - ("(?:[^"\\]|\\.)*"(?:\.\.\.)?))?(?: \+ ("(?:[^"\\]|\\.)*"(?:\.\.\.)?))?$/.exec(detail);
  if (d !== null && (d[2] !== undefined || d[3] !== undefined)) {
    for (const side of [d[2], d[3]]) if (side !== undefined) JSON.parse(side.replace(/\.\.\.$/, ""));
    const k = `${outcome} line: ${d[2] === undefined ? "" : "-"}${d[3] === undefined ? "" : "+"}`;
    add(k);
    samples[k] ??= line;
  } else {
    const k = `${outcome} reason: ${detail.replace(/[0-9]+/g, "n").slice(0, 60)}`;
    add(k);
    samples[k] ??= line;
  }
}
console.log(`${lines.length} lines, longest ${longest}, with a control character ${control}, with a character outside ASCII ${nonAscii}`);
for (const [k, n] of [...forms].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(n).padStart(6)}  ${k}`);
if (process.argv[3] === "--samples") for (const [k, l] of Object.entries(samples).slice(0, 12)) console.log(`  [${k}] ${l.slice(0, 330)}`);
