// Research probe: the list reader that decodes UTF-8 against the ground truth of the Go reader (vectors of the other pass).
import { readdirSync, readFileSync } from "node:fs";
const N = "/workspace/notes/lint/units/conformance/oracle-and-expectations/";
const { readFileNameSet } = await import(N + "top-down/prototype/baseline.ts");
const dir = N + "bottom-up/vectors/list-inputs/";
const expected = JSON.parse(readFileSync(N + "bottom-up/vectors/list-expected.json", "utf8")) as Record<string, string[]>;
let same = 0;
const differ: string[] = [];
for (const name of readdirSync(dir).sort()) {
  const bytes = readFileSync(dir + name);
  const validUtf8 = Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes);
  const got = [...readFileNameSet(bytes.toString("utf8"))];
  // the ground truth gives each entry as its bytes, one character per byte
  const want = expected[name].map(e => Buffer.from(e, "latin1").toString("utf8"));
  const a = JSON.stringify([...got].sort()), b = JSON.stringify([...new Set(want)].sort());
  if (a === b) same++; else differ.push(`${name} (valid UTF-8: ${validUtf8}): got ${a} expected ${b}`);
  if (a === b && !validUtf8) console.log("equal although the input is not valid UTF-8:", name);
}
console.log("vectors", Object.keys(expected).length, "equal", same);
for (const d of differ) console.log("  ", d);
