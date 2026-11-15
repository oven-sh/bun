import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./harness/default-timeout";
import { separatePrograms, startsAtAnyEntryPoint } from "./harness/separate-programs";

// Nobody knows what lies above console, Bun.sql or SlowBuffer in their prototype chains. The compiler took that for a proof that Object.prototype does not: `instanceof Object`
// answered false in a function, and a field that was typed `false` by it aborted the program when `true` was stored. Beside other questions about the same object the fault
// is silent, so each form is alone in its program. ./fuzz/grids/every-built-in-object-is-an-instance-of-what-plain-bun-says.ts asks every built-in object.

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function plainAndCompiled(dir: string, entry: string) {
  const plain = await run([bunExe(), entry], dir);
  const executable = join(dir, entry.replace(/\.[a-z]+$/, ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", executable], dir);
  expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });
  const compiled = await run([executable], dir);
  return { plain, compiled };
}

const inFunction = `function f() { return OBJECT instanceof Object; }\nconsole.log(f());`;
const forms: (readonly [string, string, string])[] = [
  ["console", "in a function", inFunction],
  ["Bun.sql", "in a function", inFunction],
  [`require("node:buffer").SlowBuffer`, "in a function", inFunction],
  [
    "console",
    "in the initializer of a field",
    `class C { field = OBJECT instanceof Object; }\nconsole.log(new C().field);`,
  ],
];

// One build for all of them: each is an entry point of its own, compiled as it is when it is built alone, and runs in a process of its own. Where the Bun under test
// cannot start an executable at any entry point, each has a build of its own.
const entryOf = (nth: number) => `form-${nth}.cjs`;
const textOf = ([object, , text]: (typeof forms)[number]) => text.replaceAll("OBJECT", object) + "\n";
const together =
  startsAtAnyEntryPoint &&
  separatePrograms(
    "aot-one-built-in-object",
    Object.fromEntries(forms.map((form, nth) => [entryOf(nth), textOf(form)])),
    forms.map((_, nth) => entryOf(nth)),
  );

test.concurrent.each(forms.map((form, nth) => [...form, nth] as const))(
  "%s instanceof Object, %s, alone in its program",
  async (object, where, text, nth) => {
    using dir = together
      ? undefined
      : tempDir("aot-one-built-in-object", { "main.cjs": textOf([object, where, text]) });
    const { plain, compiled } = together
      ? { plain: await run([bunExe(), entryOf(nth)], together.folder), compiled: await together.start(entryOf(nth)) }
      : await plainAndCompiled(String(dir), "main.cjs");
    expect(plain.stdout).toBe("true\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      exitCode: plain.exitCode,
    });
  },
  600_000,
);
