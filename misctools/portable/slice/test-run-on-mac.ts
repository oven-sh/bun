// Runs run-on-mac.sh on this Linux machine, to see that the script does what it says: that it
// compares right, says what differs with both values, stays under 60 lines, runs to its end when
// steps fail, when the image never ends and when a person interrupts it, and writes nothing outside
// of its directory. Every case runs under each shell that is here of: dash, bash as sh (the sh of
// macOS is bash), the sh of busybox, and zsh, which is the shell that a person has on a Mac and may
// run the script with.
//
//   bun test-run-on-mac.ts [--case <part of a name>] [--shell <name>]
//                                 after package-macos.ts. WORK as in build.ts.
//
// This machine is no Mac. The first cases are the package with something put in the place of what
// only a Mac has, and the programs of this machine:
//
//   as it is       the package as it is. The program that asks the headers does not compile, no
//                  function of macOS is bound, the slice prints what it prints on Linux.
//   all the same   the program that asks the headers prints what the image has, and the expected
//                  output is the one of Linux: the layout and the slice have to compare as equal.
//   differences    the same, with one size and one constant changed in the "headers", one part of
//                  that program that does not compile, and one step expected to end in another way.
//   no compiler    cc is a program that fails: neither the host nor the verification is built.
//
// The cases "as on a Mac" run the script with programs that stand for the ones of a Mac
// (../test/mac-tools-on-linux.ts): a cc that builds the host for macOS with the headers of macOS before
// it builds the one that runs here, and that answers for the headers of macOS about the layout; a host
// whose "libSystem" takes what macOS takes (../test/libsystem_on_linux.h), under which the image runs
// bun's code for macOS; an hdiutil whose volume is a directory where nothing clones. The expected
// output is the one of macOS, but for what the kernel of Linux answers in another way
// (expected/kernel-of-linux.json) and for the names that HFS+ takes apart.
//
//   as on a Mac, x86_64 and arm64   every step has to pass, the second one under qemu
//   hdiutil refuses                 step 5 does not run, and that is no failure
//   a step fails                    a step is expected to end in another way: the summary has to
//                                   say how it ended, and what macOS itself said
//   the image hangs                 the host never ends: the script ends it and goes on
//   interrupted                     the same, and the script gets the signal of Control-C
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const packed = join(work, "mac-package");
if (!existsSync(join(packed, "run-on-mac.sh"))) throw new Error(`${packed}: package-macos.ts has not made the package`);
const arch = process.arch === "x64" ? "x86_64" : "aarch64";
const other = arch === "x86_64" ? "aarch64" : "x86_64";
const argv = process.argv.slice(2);
const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
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
/** The expected output of macOS, where the kernel that answers shared code is the one of Linux. */
function expectedOnLinux(): string {
  let expected = readFileSync(join(here, "expected/darwin.jsonl"), "utf8");
  const kernel: { lines: { of_macos: string; of_linux: string }[] } = JSON.parse(readFileSync(join(here, "expected/kernel-of-linux.json"), "utf8"));
  for (const { of_macos, of_linux } of kernel.lines) {
    if (!expected.includes(of_macos + "\n")) throw new Error(`expected/darwin.jsonl has no line ${of_macos}`);
    expected = expected.replace(of_macos + "\n", () => of_linux + "\n");
  }
  return expected;
}
const steps = expectedOnLinux().split("\n").filter(Boolean).length;

/** The programs that stand for the ones of a Mac, and what the host that cc builds includes. */
function asOnAMac(dir: string, expected = expectedOnLinux()) {
  mkdirSync(join(dir, "bin"));
  for (const tool of ["cc", "uname", "sw_vers", "sysctl", "hdiutil"]) {
    writeFileSync(join(dir, "bin", tool), `#!/bin/sh\nexec bun '${join(tree, "test/mac-tools-on-linux.ts")}' ${tool} "$@"\n`);
    chmodSync(join(dir, "bin", tool), 0o755);
  }
  mkdirSync(join(dir, "test"));
  for (const name of readdirSync(join(tree, "test"))) if (/^(libsystem_on_linux|darwin_facts_\w+|darwin_exports_\w+)\.h$/.test(name)) cpSync(join(tree, "test", name), join(dir, "test", name));
  writeFileSync(join(dir, "expected/darwin.jsonl"), expected);
  writeFileSync(join(dir, "expected/darwin-hfs.jsonl"), expected);
}
const macEnv = (dir: string, processor: string, more: Record<string, string> = {}) => ({
  PATH: `${join(dir, "bin")}:${process.env.PATH}`,
  MAC_TOOLS_ARCH: processor,
  WORK: work,
  BUN_PORTABLE_HOST_OS: "darwin",
  BUN_HOST_TEST: "libsystem",
  BUN_HOST_TEST_NOCLONE_UNDER: join(dir, "run-tmp-other"),
  ...more,
});

type Case = {
  name: string;
  prepare: (dir: string) => void;
  env?: (dir: string) => Record<string, string>;
  /** Sends the signal of Control-C once the image runs. */
  interrupt?: boolean;
  /** The longest that the script may take, in seconds. */
  within?: number;
  expect: (summary: string[]) => string[];
};
const has = (summary: string[], pattern: RegExp) => summary.some(line => pattern.test(line));
const passes = (processor: string) => (summary: string[]) => [
  has(summary, new RegExp(`^macOS \\S+ \\(headers\\), ${processor === "aarch64" ? "arm64" : "x86_64"}, `)) ? "" : "the first line does not name the system and the processor",
  has(summary, /^1\. host: built, 0 warnings/) ? "" : "the host is not reported as built without a warning",
  has(summary, /^2\. layout \(the image, run here\): \d{3} facts are the same, 0 DIFFER, 0 are not in the headers, 0 of \d+ parts do not compile/) ? "" : "the layout is not reported as the same",
  has(summary, /^3\. imports of macOS: \d+ functions, 0 missing/) ? "" : "the imports are not reported as bound",
  has(summary, new RegExp(`^4\\. slice in run-tmp: exit code 0, ${steps} steps, ALL AS EXPECTED`)) ? "" : "the slice is not reported as expected",
  has(summary, /^ {3}the copies were made by: clonefile$/) ? "" : "the copies of step 4 are not reported as made by clonefile",
  has(summary, new RegExp(`^5\\. slice in run-tmp-other: exit code 0, ${steps} steps, ALL AS EXPECTED`)) ? "" : "the slice on the other volume is not reported as expected",
  has(summary, /^ {3}the copies were made by: copyfile, after clonefile was refused with ENOTSUP \(errno 45 of macOS\)$/) ? "" : "the copies of step 5 are not reported as made by copyfile after ENOTSUP",
  has(summary, /^PASSED\. /) ? "" : "the verdict is not PASSED",
];
const cases: Case[] = [
  {
    name: "as it is",
    prepare() {},
    expect: summary => [
      has(summary, /^1\. host: built/) ? "" : "the host is not reported as built",
      has(summary, /^2\. layout: verify\/darwin_layout\.c DOES NOT COMPILE/) ? "" : "the layout is not reported as not compiled",
      has(summary, /^3\. imports of macOS: \d+ functions, \d+ missing/) ? "" : "no line of the imports",
      has(summary, /^4\. slice in run-tmp: exit code 0, \d+ steps of \d+, NOT AS EXPECTED in \d+/) ? "" : "the slice is not reported as other than expected",
      has(summary, /rmdir, not empty \[a\]: FAILS with ENOTEMPTY, errno 39; bun names the call unlink <- EXPECTED: FAILS with ENOTEMPTY, errno 66/) ? "" : "a step that fails is not shown with the name and the number of its error, next to what was expected",
      has(summary, /\(the step did not come\) <- EXPECTED: clonefile \[a\/clone\.txt\]: "content":"hello, world\\nappended\\n",ok/) ? "" : "a step that did not come is not shown on one line, with what it is expected to print",
      has(summary, /^5\. slice on a volume that does not clone: not run, there is no hdiutil/) ? "" : "step 5 is not reported as not run",
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
      has(summary, /^4\. slice in run-tmp: exit code 0, \d+ steps, ALL AS EXPECTED/) ? "" : "the slice is not reported as expected",
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
      writeFileSync(join(dir, "expected/darwin.jsonl"), linuxExpected.replace('{"step":"mkdir again","ok":false,"error":"EEXIST","errno":17}', '{"step":"mkdir again","ok":true}') + '{"step":"one more","ok":true}\n');
    },
    expect: summary => [
      has(summary, /^2\. layout .*: \d+ facts are the same, 2 DIFFER, \d+ are not in the headers, 1 of 3 parts do not compile/) ? "" : "the layout is not reported with 2 differences and 1 part",
      has(summary, /fields that the headers of this macOS do not have: short_one: b/) ? "" : "the field that the headers do not have is not named",
      has(summary, /size stat: 144 in the image, 128 in the headers/) ? "" : "the size that differs is not shown with both values",
      has(summary, /constant O_CLOEXEC: 16777216 in the image, 524288 in the headers/) ? "" : "the constant that differs is not shown with both values",
      has(summary, /constant F_GETPATH \(the headers have no macro of this name\)/) ? "" : "the constant that the headers do not have is not named",
      has(summary, /type that_is_not_there: /) ? "" : "the part that does not compile is not named",
      has(summary, /mkdir again: FAILS with EEXIST, errno 17; bun names the call mkdir <- EXPECTED: ok/) ? "" : "the step that ends in another way is not shown with the call that bun names",
      has(summary, /\(the step did not come\) <- EXPECTED: one more: ok/) ? "" : "the step that did not come is not shown",
    ],
  },
  {
    name: "no compiler",
    prepare(dir) {
      mkdirSync(join(dir, "bin"));
      writeFileSync(join(dir, "bin/cc"), "#!/bin/sh\necho 'host_posix.c:1:1: error: this compiler compiles nothing' >&2\nexit 1\n");
      chmodSync(join(dir, "bin/cc"), 0o755);
    },
    env: dir => ({ PATH: `${join(dir, "bin")}:${process.env.PATH}` }),
    expect: summary => [
      has(summary, /^1\. host: DOES NOT COMPILE/) ? "" : "the host is not reported as not compiled",
      has(summary, /error: this compiler compiles nothing/) ? "" : "the message of the compiler is not shown",
      has(summary, /^3\. imports: not run/) && has(summary, /^4\. slice: not run/) && has(summary, /^5\. .*: not run/) ? "" : "the steps that need the host are not reported as not run",
      has(summary, /^FAILED\. /) ? "" : "the verdict is not FAILED",
    ],
  },
  { name: `as on a Mac, ${arch}`, prepare: dir => asOnAMac(dir), env: dir => macEnv(dir, arch), expect: passes(arch) },
  { name: `as on a Mac, ${other}`, prepare: dir => asOnAMac(dir), env: dir => macEnv(dir, other), expect: passes(other) },
  {
    name: "as on a Mac, hdiutil refuses",
    prepare: dir => asOnAMac(dir),
    env: dir => macEnv(dir, arch, { MAC_TOOLS_HDIUTIL: "refuses" }),
    expect: summary => [
      has(summary, new RegExp(`^4\\. slice in run-tmp: exit code 0, ${steps} steps, ALL AS EXPECTED`)) ? "" : "the slice is not reported as expected",
      has(summary, /^5\. slice on a volume that does not clone: not run, hdiutil did not make the volume: hdiutil: attach failed - Operation not permitted/) ? "" : "step 5 is not reported as not run, with what hdiutil said",
      has(summary, /^PASSED\. /) ? "" : "the verdict is not PASSED",
    ],
  },
  {
    name: "as on a Mac, a step fails",
    prepare: dir =>
      asOnAMac(
        dir,
        expectedOnLinux()
          .replace('{"step":"open, missing","ok":false,"error":"ENOENT","errno":2}', '{"step":"open, missing","ok":true}')
          .replace('{"step":"rmdir, not empty","path":"a","ok":false,"error":"ENOTEMPTY","errno":66}', '{"step":"rmdir, not empty","path":"a","ok":false,"error":"EEXIST","errno":17}'),
      ),
    env: dir => macEnv(dir, arch),
    expect: summary => [
      has(summary, new RegExp(`^4\\. slice in run-tmp: exit code 0, ${steps} steps of ${steps}, NOT AS EXPECTED in 2 `)) ? "" : "the slice is not reported with 2 differences",
      has(summary, /^ {4}open, missing: FAILS with ENOENT, errno 2; macOS itself said errno 2; bun names the call open <- EXPECTED: ok$/) ? "" : "the step that failed in a function of macOS is not shown with what macOS said",
      has(summary, /^ {4}rmdir, not empty \[a\]: FAILS with ENOTEMPTY, errno 66; bun names the call unlink <- EXPECTED: FAILS with EEXIST, errno 17$/) ? "" : "the step that failed in shared code is not shown with the number that macOS has for the error",
      has(summary, /^FAILED\. /) ? "" : "the verdict is not FAILED",
    ],
  },
  {
    name: "as on a Mac, the image hangs",
    prepare: dir => asOnAMac(dir),
    env: dir => macEnv(dir, arch, { MAC_TOOLS_HOST: "hangs", BUN_RUN_ON_MAC_SECONDS: "3" }),
    expect: summary => [
      has(summary, /the image DOES NOT START under the host: exit code 137 \(it was ended: by this script after 3 seconds, or by macOS\)/) ? "" : "the image is not reported as ended by the script",
      has(summary, /^2\. layout \(the image, as it was run where it was built\): \d{3} facts are the same, 0 DIFFER/) ? "" : "the layout is not compared with what the image printed where it was built",
      has(summary, /^5\. .*: not run/) ? "" : "step 5 is not reported as not run",
      has(summary, /^3\. imports: not run/) && has(summary, /^4\. slice: not run/) ? "" : "the steps that need the image are not reported as not run",
      has(summary, /^FAILED\. /) ? "" : "the verdict is not FAILED",
    ],
  },
  {
    name: "as on a Mac, interrupted",
    prepare: dir => asOnAMac(dir),
    // Without the interruption the script would wait for as long as it gives the image.
    env: dir => macEnv(dir, arch, { MAC_TOOLS_HOST: "hangs", BUN_RUN_ON_MAC_SECONDS: "900" }),
    interrupt: true,
    within: 600,
    expect: summary => [
      has(summary, /the image DOES NOT START under the host: exit code/) ? "" : "the image is not reported as ended",
      has(summary, /^the run was interrupted: the steps that were left did not run/) ? "" : "the summary does not say that the run was interrupted",
      has(summary, /^2\. layout: not run/) && has(summary, /^3\. imports: not run/) && has(summary, /^4\. slice: not run/) ? "" : "the steps that were left are not reported as not run",
      has(summary, /^FAILED\. /) ? "" : "the verdict is not FAILED",
    ],
  },
];

const busybox = "/tmp/portable/u4/cache/bbin/sh";
const zsh = "/tmp/portable/u4/cache/zsh-x86_64/bin/zsh";
const shells: { name: string; command: string[] }[] = [
  { name: "dash", command: ["dash"] },
  { name: "bash", command: ["bash", "--posix"] },
  ...(existsSync(busybox) ? [{ name: "busybox", command: [busybox] }] : []),
  ...(existsSync(zsh) ? [{ name: "zsh", command: [zsh] }] : []),
].filter(shell => !option("--shell") || shell.name === option("--shell"));

let failed = 0;
for (const shell of shells) {
  for (const one of cases) {
    if (option("--case") && !one.name.includes(option("--case")!)) continue;
    const dir = join(root, shell.name, one.name.replaceAll(/[ ,]+/g, "-"));
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(packed, dir, { recursive: true });
    one.prepare(dir);
    const before = readdirSync(dirname(dir)).sort().join(" ");
    const started = Date.now();
    // From another directory: the script has to find its own.
    const child = Bun.spawn([...shell.command, join(dir, "run-on-mac.sh")], { cwd: "/", env: { ...process.env, ...one.env?.(dir) }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    if (one.interrupt) {
      // The image runs once what it prints has a file.
      while (!existsSync(join(dir, "logs/layout-image.jsonl")) && child.exitCode === null) await Bun.sleep(100);
      await Bun.sleep(1500);
      child.kill("SIGINT");
    }
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const took = (Date.now() - started) / 1000;
    const summary = out.split("\n").filter(line => line !== "");
    const problems = one.expect(summary).filter(Boolean);
    if (summary.length > 60) problems.push(`the summary has ${summary.length} lines`);
    if (summary.some(line => line.length > 200)) problems.push(`a line of the summary has more than 200 characters`);
    if (err.trim()) problems.push(`the script wrote to its standard error: ${err.trim().split("\n")[0]}`);
    if (!existsSync(join(dir, "run-on-mac-logs.tar"))) problems.push("no run-on-mac-logs.tar");
    if (!summary[summary.length - 1]?.includes(join(dir, "run-on-mac-logs.tar"))) problems.push("the last line does not name the file with the logs");
    for (const left of ["run-tmp", "run-tmp-other", "build"]) if (existsSync(join(dir, left))) problems.push(`the script left ${left}`);
    if (readdirSync(dirname(dir)).sort().join(" ") !== before) problems.push("the script wrote next to its directory");
    if ((code === 0) !== summary[summary.length - 1]?.startsWith("PASSED")) problems.push(`exit code ${code}`);
    if (one.within && took > one.within) problems.push(`it took ${took.toFixed(0)} seconds, more than ${one.within}`);
    writeFileSync(join(dirname(dir), `${one.name.replaceAll(/[ ,]+/g, "-")}.summary.txt`), out);
    console.log(`${shell.name}, ${one.name}: ${problems.length ? "FAILED" : "passed"}, ${summary.length} lines, ${took.toFixed(0)} seconds${problems.map(problem => `\n   ${problem}`).join("")}`);
    failed += problems.length ? 1 : 0;
  }
}
process.exit(failed ? 1 : 0);
