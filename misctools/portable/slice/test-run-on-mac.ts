// Runs run-on-mac.sh on this Linux machine, with dash, to see that the script does what it says:
// that it compares right, says what differs with both values, stays under 60 lines, runs to its end
// when steps fail, and writes nothing outside of its directory.
//
//   bun test-run-on-mac.ts        after package-macos.ts. WORK as in build.ts.
//
// This machine is no Mac: it has no headers of macOS, its host is the Linux test host, and the image
// takes bun's code for Linux. So each case below is the package with something put in the place of
// what only a Mac has:
//
//   as it is       the package as it is. The program that asks the headers does not compile, no
//                  function of macOS is bound, the slice prints what it prints on Linux.
//   all the same   the program that asks the headers prints what the image has, and the expected
//                  output is the one of Linux: the layout and the slice have to compare as equal.
//   differences    the same, with one size and one constant changed in the "headers", one part of
//                  that program that does not compile, and one step expected to end in another way.
//   no compiler    cc is a program that fails: neither the host nor the verification is built.
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const packed = join(work, "mac-package");
if (!existsSync(join(packed, "run-on-mac.sh"))) throw new Error(`${packed}: package-macos.ts has not made the package`);
const arch = process.arch === "x64" ? "x86_64" : "aarch64";
const root = join(work, "run-on-mac-test");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

/** A program with the parts of darwin_layout.c that prints the facts it is given: the first `parts - 1`
    parts hold them, the last one is for a case to fill. */
function layoutProgram(facts: string[], broken = false): string {
  const lines = facts.map(fact => `  puts(${JSON.stringify(fact)});`);
  // Part 3 names a field that its structure does not have: the script has to leave that one out.
  return `#include <stdio.h>\n#include <stddef.h>\nstruct short_one { int a; };\nint main(void) {\n#if PART == 0\n  puts("${broken ? 3 : 2}");\n#endif\n#if PART == 1\n${lines.join("\n")}\n#endif\n#if PART == 2\n${broken ? "  this part does not compile;" : ""}\n#endif\n#if PART == 3\n  printf("{\\"fact\\":\\"offset\\",\\"of\\":\\"short_one.a\\",\\"value\\":%zu}\\n", offsetof(struct short_one, a));\n#ifndef SKIP_short_one_b\n  printf("%zu", offsetof(struct short_one, b));\n#endif\n#endif\n  return 0;\n}\n`;
}
const imageFacts = readFileSync(join(packed, `verify/image-layout-${arch}.jsonl`), "utf8").split("\n").filter(Boolean);
const linuxExpected = readFileSync(join(here, "expected/linux.jsonl"), "utf8").replace(/,"syscall":"[^"]*"/g, "");

type Case = { name: string; prepare: (dir: string) => void; env?: Record<string, string>; expect: (summary: string[]) => string[] };
const has = (summary: string[], pattern: RegExp) => summary.some(line => pattern.test(line));
const cases: Case[] = [
  {
    name: "as it is",
    prepare() {},
    expect: summary => [
      has(summary, /^1\. host: built/) ? "" : "the host is not reported as built",
      has(summary, /^2\. layout: verify\/darwin_layout\.c DOES NOT COMPILE/) ? "" : "the layout is not reported as not compiled",
      has(summary, /^3\. imports of macOS: \d+ functions, \d+ missing/) ? "" : "no line of the imports",
      has(summary, /^4\. slice: exit code 0, \d+ steps of \d+, NOT AS EXPECTED/) ? "" : "the slice is not reported as other than expected",
      has(summary, /rmdir, not empty \[a\]: FAILS with ENOTEMPTY, errno 39/) && has(summary, /expected rmdir, not empty \[a\]: FAILS with ENOTEMPTY, errno 66/) ? "" : "a step that fails is not shown with the name and the number of its error, next to what was expected",
      has(summary, /^FAILED\. /) ? "" : "the verdict is not FAILED",
    ],
  },
  {
    name: "all the same",
    prepare(dir) {
      writeFileSync(join(dir, "verify/darwin_layout.c"), layoutProgram(imageFacts));
      writeFileSync(join(dir, "verify/parts.txt"), "1 every fact\n2 nothing\n");
      writeFileSync(join(dir, "expected/darwin.jsonl"), linuxExpected);
    },
    expect: summary => [
      has(summary, new RegExp(`^2\\. layout \\(the image, run here\\): ${imageFacts.length} facts are the same, 0 DIFFER, 0 are not in the headers, 0 of 2 parts do not compile`)) ? "" : "the layout is not reported as the same",
      has(summary, /^4\. slice: exit code 0, \d+ steps, ALL AS EXPECTED/) ? "" : "the slice is not reported as expected",
      has(summary, /^FAILED\. /) ? "" : "the verdict is not FAILED, and no function of macOS was bound",
    ],
  },
  {
    name: "differences",
    prepare(dir) {
      const changed = imageFacts
        .map(fact => (fact === '{"fact":"size","of":"stat","value":144}' ? '{"fact":"size","of":"stat","value":128}' : fact))
        .map(fact => (fact.startsWith('{"fact":"constant","of":"O_CLOEXEC",') ? '{"fact":"constant","of":"O_CLOEXEC","value":524288}' : fact))
        .map(fact => (fact.startsWith('{"fact":"constant","of":"F_GETPATH",') ? '{"fact":"constant","of":"F_GETPATH","value":"no macro of this name"}' : fact))
        .filter(fact => !fact.includes('"of":"kevent64_s'));
      if (changed.join("\n") === imageFacts.join("\n")) throw new Error("the facts have no size of stat");
      writeFileSync(join(dir, "verify/darwin_layout.c"), layoutProgram(changed, true));
      writeFileSync(join(dir, "verify/parts.txt"), "1 every fact\n2 type that_is_not_there\n3 type short_one\n");
      writeFileSync(join(dir, "expected/darwin.jsonl"), linuxExpected.replace('{"step":"mkdir again","ok":false,"error":"EEXIST","errno":17}', '{"step":"mkdir again","ok":true}'));
    },
    expect: summary => [
      has(summary, /^2\. layout .*: \d+ facts are the same, 2 DIFFER, \d+ are not in the headers, 1 of 3 parts do not compile/) ? "" : "the layout is not reported with 2 differences and 1 part",
      has(summary, /fields that the headers of this macOS do not have: short_one: b/) ? "" : "the field that the headers do not have is not named",
      has(summary, /size stat: 144 in the image, 128 in the headers/) ? "" : "the size that differs is not shown with both values",
      has(summary, /constant O_CLOEXEC: 16777216 in the image, 524288 in the headers/) ? "" : "the constant that differs is not shown with both values",
      has(summary, /type that_is_not_there: /) ? "" : "the part that does not compile is not named",
      has(summary, /got      mkdir again: FAILS with EEXIST, errno 17/) && has(summary, /expected mkdir again: ok/) ? "" : "the step that ends in another way is not shown",
      has(summary, /bun attributes the error to mkdir/) ? "" : "the system call of the step is not shown",
    ],
  },
  {
    name: "no compiler",
    prepare(dir) {
      mkdirSync(join(dir, "bin"));
      writeFileSync(join(dir, "bin/cc"), "#!/bin/sh\necho 'host_posix.c:1:1: error: this compiler compiles nothing' >&2\nexit 1\n");
      chmodSync(join(dir, "bin/cc"), 0o755);
    },
    env: { PATH: "" },
    expect: summary => [
      has(summary, /^1\. host: DOES NOT COMPILE/) ? "" : "the host is not reported as not compiled",
      has(summary, /error: this compiler compiles nothing/) ? "" : "the message of the compiler is not shown",
      has(summary, /^3\. imports: not run/) && has(summary, /^4\. slice: not run/) ? "" : "the steps that need the host are not reported as not run",
      has(summary, /^FAILED\. /) ? "" : "the verdict is not FAILED",
    ],
  },
];

let failed = 0;
for (const one of cases) {
  const dir = join(root, one.name.replaceAll(" ", "-"));
  cpSync(packed, dir, { recursive: true });
  one.prepare(dir);
  const before = readdirSync(root).sort().join(" ");
  const env = { ...process.env, ...(one.env?.PATH === "" ? { PATH: `${join(dir, "bin")}:${process.env.PATH}` } : {}) };
  // From another directory: the script has to find its own.
  const result = Bun.spawnSync(["dash", join(dir, "run-on-mac.sh")], { cwd: "/", env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const summary = result.stdout.toString().split("\n").filter(line => line !== "");
  const problems = one.expect(summary).filter(Boolean);
  if (summary.length > 60) problems.push(`the summary has ${summary.length} lines`);
  if (result.stderr.toString().trim()) problems.push(`the script wrote to its standard error: ${result.stderr.toString().trim().split("\n")[0]}`);
  if (!existsSync(join(dir, "run-on-mac-logs.tar"))) problems.push("no run-on-mac-logs.tar");
  if (!summary[summary.length - 1]?.includes(join(dir, "run-on-mac-logs.tar"))) problems.push("the last line does not name the file with the logs");
  if (existsSync(join(dir, "run-tmp")) || existsSync(join(dir, "build"))) problems.push("the script left its working directories");
  if (readdirSync(root).sort().join(" ") !== before) problems.push("the script wrote next to its directory");
  if ((result.exitCode === 0) !== summary[summary.length - 1]?.startsWith("PASSED")) problems.push(`exit code ${result.exitCode}`);
  writeFileSync(join(root, `${one.name.replaceAll(" ", "-")}.summary.txt`), result.stdout);
  console.log(`${one.name}: ${problems.length ? "FAILED" : "passed"}, ${summary.length} lines${problems.map(problem => `\n   ${problem}`).join("")}`);
  failed += problems.length ? 1 : 0;
}
process.exit(failed ? 1 : 0);
