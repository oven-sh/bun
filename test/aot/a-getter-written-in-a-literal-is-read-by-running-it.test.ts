// A getter written in a literal lies IN the slot of its name, as a pair of getter and setter: a cell that is no value of the language. No road of the compiler may read that slot raw:
// each read runs the getter, and its calls are counted. --aot-harden=proof-checks tests what a field gives against what the compiler has proven of it, so a raw read stops the process there.
// Four of these seven stopped with exit code 134 while a loop read such a slot once in front of itself.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { withoutCoreDump, withoutCrashReport } from "./harness/commands";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

const built = isWindows ? "built.exe" : "built";
const programs: Record<string, string> = {
  "in every turn of a loop": `function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
let calls = 0; const rows = [3, 1, 4, 1, 5]; const data = { get rows() { calls++; return rows; } };
const rounds = JSON.parse("3"); for (let r = 0; r < rounds; r++) console.log(f(data, r), calls);
`,
  "in one arm of a turn": `function f(data, t) { let s = t & 1; for (let i = 0; i < 5; i++) { if (i & 1) s = s + data.rows[i]; } return s; }
let calls = 0; const rows = [3, 1, 4, 1, 5]; const data = { get rows() { calls++; return rows; } };
const rounds = JSON.parse("3"); for (let r = 0; r < rounds; r++) console.log(f(data, r), calls);
`,
  "outside a loop": `function f(data, t) { return data.rows[t] + data.rows.length; }
let calls = 0; const rows = [3, 1, 4, 1, 5]; const data = { get rows() { calls++; return rows; } };
const rounds = JSON.parse("3"); for (let r = 0; r < rounds; r++) console.log(f(data, r), calls);
`,
  "off a constant that names the literal": `let calls = 0; const rows = [3, 1, 4, 1, 5]; const data = { get rows() { calls++; return rows; } };
function f(unused, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = JSON.parse("3"); for (let r = 0; r < rounds; r++) console.log(f(data, r), calls);
`,
  "where the getter stands on the way to the list": `function f(box, t) { let s = t & 1; for (let i = 0; i < box.inner.rows.length; i++) s = s + box.inner.rows[i]; return s; }
let calls = 0; const rows = [3, 1, 4, 1, 5]; const inner = { rows }; const data = { get inner() { calls++; return inner; } };
const rounds = JSON.parse("3"); for (let r = 0; r < rounds; r++) console.log(f(data, r), calls);
`,
  "off this in a method of the literal": `let calls = 0; const rows = [3, 1, 4, 1, 5]; const data = { get rows() { calls++; return rows; }, sum(t) { let s = t & 1; for (let i = 0; i < this.rows.length; i++) s = s + this.rows[i]; return s; } };
const rounds = JSON.parse("3"); for (let r = 0; r < rounds; r++) console.log(data.sum(r), calls);
`,
  "where a setter stands beside the getter": `function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; data.rows = t; return s; }
let calls = 0, stores = 0; const rows = [3, 1, 4, 1, 5]; const data = { get rows() { calls++; return rows; }, set rows(value) { stores += value; } };
const rounds = JSON.parse("3"); for (let r = 0; r < rounds; r++) console.log(f(data, r), calls, stores);
`,
};

describe.concurrent("a getter written in a literal is read by running it", () => {
  for (const [where, program] of Object.entries(programs))
    for (const flags of [[], ["--aot-harden=proof-checks"], ["--aot-check=Validate"]])
      test(`${where}${flags.length ? ", " + flags[0] : ""}`, async () => {
        using folder = tempDir("getter-in-a-literal", { "program.js": program });
        const cwd = String(folder);
        const made = await spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, "program.js", "--outfile", "built"],
          cwd,
        );
        expect({ stderr: made.stderr.includes("error:") ? made.stderr : "", exitCode: made.exitCode }).toEqual({
          stderr: "",
          exitCode: 0,
        });
        const plain = await spawned([bunExe(), "program.js"], cwd, bunEnv);
        const compiled = await spawned(withoutCoreDump([join(cwd, built)]), cwd, { ...bunEnv, ...withoutCrashReport });
        expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
          stdout: plain.stdout,
          stderr: "",
          exitCode: 0,
        });
      }, 120_000);
});
