// Compares the output of a run of bun_fs_slice with the expected output.
//
//   bun compare-run.ts <output.jsonl> [--expected expected/linux.jsonl]
//
// The expected output is the one of Linux. On another host (the first line of the output names it)
// the differences that expected/differences.json lists are accepted, and printed as such.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(import.meta.path);
const args = process.argv.slice(2);
const outputPath = args.find(a => !a.startsWith("--"));
if (!outputPath) throw new Error("usage: bun compare-run.ts <output.jsonl> [--expected file]");
const expectedPath = args.includes("--expected")
  ? args[args.indexOf("--expected") + 1]
  : join(here, "expected/linux.jsonl");
type Line = Record<string, unknown> & { step: string; path?: string; ok: boolean; error?: string };
const parse = (path: string): Line[] =>
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
const output = parse(outputPath);
const expected = parse(expectedPath);
const rules = JSON.parse(readFileSync(join(here, "expected/differences.json"), "utf8"));
const host = String(output[0]?.os ?? "");
const forHost: Record<string, any> = host === "linux" ? {} : (rules[host] ?? {});
const key = (line: Line) => (line.path ? `${line.step} ${line.path}` : line.step);

const absent = new Set<string>();
const notListed = new Set<string>();
let accepted = 0,
  same = 0;
const unexpected: string[] = [];
let at = 0;
for (const want of expected) {
  const k = key(want);
  if (absent.has(k) || absent.has(want.step)) {
    if (output[at] && key(output[at]) === k) unexpected.push(`${k}: printed, and was expected to be absent`);
    else accepted++;
    continue;
  }
  const got = output[at];
  if (!got || key(got) !== k) {
    unexpected.push(`${k}: missing (the output has ${got ? key(got) : "nothing"} here)`);
    continue;
  }
  at++;
  const rule = forHost[k];
  const problems: string[] = [];
  let usedRule = false;
  if (rule?.may_fail_with && got.ok === false && rule.may_fail_with.includes(got.error)) {
    for (const name of rule.then_absent ?? []) absent.add(name);
    for (const name of rule.then_not_listed ?? []) notListed.add(name);
    accepted++;
    console.log(`accepted   ${k}: ${got.error} (${rule.why})`);
    continue;
  }
  for (const field of new Set([...Object.keys(want), ...Object.keys(got)])) {
    if (field === "syscall" && host !== "linux") continue;
    let wanted: unknown = want[field];
    if (field === "entries" && Array.isArray(wanted)) wanted = wanted.filter((e: any) => !notListed.has(e.name));
    if (rule?.fields && field in rule.fields) {
      wanted = rule.fields[field];
      usedRule = true;
    }
    if (rule?.error && field === "error") {
      if (rule.error.includes(got.error)) {
        usedRule = true;
        continue;
      }
    }
    if (JSON.stringify(wanted) !== JSON.stringify(got[field]))
      problems.push(`${field}: ${JSON.stringify(got[field])}, expected ${JSON.stringify(wanted)}`);
  }
  if (problems.length) unexpected.push(`${k}: ${problems.join("; ")}`);
  else if (usedRule) {
    accepted++;
    console.log(`accepted   ${k}: ${rule.why}`);
  } else same++;
}
for (const extra of output.slice(at)) unexpected.push(`${key(extra)}: not expected`);
for (const line of unexpected) console.log(`UNEXPECTED ${line}`);
console.log(
  `host ${host}: ${same} steps as on Linux, ${accepted} accepted differences, ${unexpected.length} unexpected`,
);
process.exit(unexpected.length ? 1 : 0);
