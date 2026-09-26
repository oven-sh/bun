// Writes the expected output of bun_fs_slice for a host from the one of Linux and the differences.
//
//   bun expected.ts darwin [--out expected/darwin.jsonl]
//   bun expected.ts darwin-hfs [--out expected/darwin-hfs.jsonl]
//
// expected/linux.jsonl is what a run on Linux prints. expected/differences.json says what another host
// prints in its place. For macOS that is everything there is to say, so the expected output of macOS can
// be written down, line by line, and a run on a Mac can be compared with it by cmp and diff: the Mac
// needs no bun for it. (For Windows a step may end in two ways, and compare-run.ts decides.)
//
// darwin-hfs is macOS on a volume of HFS+, where run-on-mac.sh runs the slice a second time because
// that file system does not clone. What is compared is the same but for one thing: HFS+ keeps a name
// with its letters taken apart (ü is u and the two dots), and hands it out that way.
//
// The name of the system call is left out of every line: it is compared on Linux only.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(import.meta.path);
const [variant, ...rest] = process.argv.slice(2);
if (variant !== "darwin" && variant !== "darwin-hfs") throw new Error("usage: bun expected.ts darwin|darwin-hfs [--out file]");
const host = "darwin";
const out = rest[0] === "--out" ? rest[1] : join(here, `expected/${variant}.jsonl`);

type Line = Record<string, unknown> & { step: string; path?: string };
const linux: Line[] = readFileSync(join(here, "expected/linux.jsonl"), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
const rules = JSON.parse(readFileSync(join(here, "expected/differences.json"), "utf8"))[host];
const numbers: { errno: { name: string; macos: string }[] } = JSON.parse(readFileSync(join(here, rules.errno.numbers), "utf8"));
const errnoOf = (name: string) => {
  const found = numbers.errno.find(entry => entry.name === name);
  if (!found) throw new Error(`${name}: no such error number of macOS in ${rules.errno.numbers}`);
  return Number(found.macos);
};
const key = (line: Line) => (line.path ? `${line.step} ${line.path}` : line.step);
/** The fields in the order the slice prints them: the ones of the step, then ok, error, errno. */
const ordered = (line: Line): Line => {
  const { ok, error, errno, syscall, ...fields } = line;
  void syscall;
  return { ...fields, ok, ...(error === undefined ? {} : { error, errno }) } as Line;
};

const lines: Line[] = [];
const used = new Set<string>();
for (const line of linux) {
  const rule = rules[key(line)];
  let expected: Line = { ...line };
  if (rule) {
    used.add(key(line));
    if (rule.fields) expected = { ...expected, ...rule.fields };
    if (rule.error) expected.error = rule.error[0];
  }
  if (typeof expected.error === "string") expected.errno = errnoOf(expected.error);
  lines.push(ordered(expected));
  if (rules.only_here?.after === key(line)) {
    used.add("only_here");
    for (const step of rules.only_here.steps as Line[]) lines.push(ordered(typeof step.error === "string" ? { ...step, errno: errnoOf(step.error) } : step));
  }
}
for (const name of Object.keys(rules)) if (!used.has(name) && !["errno", "absent"].includes(name) && !(name === "only_here" && !rules.only_here)) throw new Error(`differences.json, ${host}: no step of Linux is named "${name}"`);
if (variant === "darwin-hfs") {
  let taken_apart = 0;
  for (const line of lines) {
    if (!Array.isArray(line.entries)) continue;
    for (const entry of line.entries as { name: string }[]) {
      const name = entry.name.normalize("NFD");
      if (name !== entry.name) taken_apart++;
      entry.name = name;
    }
    // The slice sorts the names by their bytes, and so does this.
    (line.entries as { name: string }[]).sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  }
  if (taken_apart !== 1) throw new Error(`${taken_apart} names of the listing change on HFS+, expected one`);
}
writeFileSync(out, lines.map(line => JSON.stringify(line)).join("\n") + "\n");
console.log(`${out}: ${lines.length} steps`);
