// Everything that JavaScript lets anybody do to an object, done to every kind of object that typed code makes: the cases of
// ./generated/python/external-sources-of-typed-objects.py, 120 to a program. Most cases print what plain Bun prints. Of those that do not,
// ./generated/external-sources-of-typed-objects.json says how they depart:
//
//   "TypeError"  --aot throws a TypeError that plain Bun does not throw: the case does what --aot does not allow
//   "differs"    it prints something else
//
// A verdict that changes fails the test, for better or for worse. AOT_PROGRAMS_UPDATE=1 rewrites the file.
import { spawnSync } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported, wanted } from "./run-programs";

const recorded = join(import.meta.dir, "generated", "external-sources-of-typed-objects.json");
const verdicts: Record<string, string> = JSON.parse(readFileSync(recorded, "utf8"));
const updates = !!process.env.AOT_PROGRAMS_UPDATE;
const python = Bun.which("python3");
if (!python) console.error("SKIPPED: test/aot/external-sources-of-typed-objects.test.ts: python3 is not installed");
const root = String(tempDir("aot-doors", {}));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  if (updates) writeFileSync(recorded, JSON.stringify(verdicts, null, 1) + "\n");
});

/** `<case>: <answer>` is what a case prints, and `#<case>: <error>` stands behind it for each error that was caught on the way. */
function read(stdout: string) {
  const answers = new Map<string, string>();
  const errors = new Map<string, string[]>();
  for (const line of stdout.split("\n")) {
    const at = line.indexOf(": ");
    if (at < 0) continue;
    if (line.startsWith("#"))
      errors.set(line.slice(1, at), [...(errors.get(line.slice(1, at)) ?? []), line.slice(at + 2)]);
    else answers.set(line.slice(0, at), line.slice(at + 2));
  }
  return { answers, errors };
}

describe.concurrent("compile/aot/doors to typed objects", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  if (!python) return void test.skip("python3 is not installed", () => {});
  for (let part = 1; part <= 17; part++) {
    if (wanted === "quick" && part > 2) continue;
    test(
      `part ${part}`,
      () =>
        slot(async () => {
          const folder = join(root, String(part));
          mkdirSync(folder, { recursive: true });
          const written = spawnSync({
            cmd: [
              python,
              "-B",
              join(import.meta.dir, "generated", "python", "external-sources-of-typed-objects.py"),
              String(part),
            ],
            stderr: "pipe",
          });
          if (written.exitCode !== 0) throw new Error(String(written.stderr));
          writeFileSync(join(folder, "main.ts"), written.stdout);
          const executable = join(folder, isWindows ? "program.exe" : "program");
          try {
            built(
              await spawned(
                [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
                folder,
                bunEnv,
              ),
            );
            const compiled = await spawned([executable], folder, bunEnv);
            const plain = await spawned([bunExe(), "run", "main.ts"], folder, bunEnv);
            expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
            expect({ signal: compiled.signal, exitCode: compiled.exitCode }).toEqual({ signal: null, exitCode: 0 });
            const [ours, theirs] = [read(compiled.stdout), read(plain.stdout)];
            const found: Record<string, string> = {};
            const expected: Record<string, string> = {};
            for (const [name, answer] of theirs.answers) {
              if (verdicts[name]) expected[name] = verdicts[name];
              if (ours.answers.get(name) === answer) continue;
              const isRefused = ours.errors
                .get(name)
                ?.some(error => error.startsWith("TypeError") && !theirs.errors.get(name)?.includes(error));
              found[name] = isRefused ? "TypeError" : "differs";
            }
            if (updates) {
              for (const name of theirs.answers.keys()) delete verdicts[name];
              Object.assign(verdicts, found);
            } else expect(found).toEqual(expected);
          } finally {
            rmSync(executable, { force: true });
          }
        }),
      600_000,
    );
  }
});
