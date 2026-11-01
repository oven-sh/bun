// A program may ask while it runs what compiled code did: `typeof aotRuntimeCounters === "function"`. Only the `jsc` shell has such a function. In an
// executable there is none, and the program says what it says for 0. Whoever is asked about such a program runs it in the shell too: run-parallel.ts,
// shell/expectations.py, and shell/quick.py as anybody starts it. None of them passes it whatever it counts, and where there is no shell the driver says
// that it has not asked. shell/tools.ts says what the scripts need.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const isCanary = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");

// Only the run knows the text of the pattern, so the run time makes one pattern that the build has no record of.
const makesOnePattern = `// Env: JSC_aotCountsPath=/dev/null
const counts = typeof aotRuntimeCounters === "function";
const made = () => (counts ? Number(/^(\\d+)\\tcounter:RegExpsCreatedWithoutRecord$/m.exec(aotRuntimeCounters())[1]) : 0);
const before = made();
console.log(new RegExp("^" + Date.now() + "$").test("no"));
const patterns = made() - before;
`;
const saysNone = `${makesOnePattern}console.log(patterns === 0 ? "no pattern is made at run time" : "patterns made at run time: " + patterns);\n`;
const programs = {
  "counts/says-one-where-one-is-made.js": `${makesOnePattern}console.log(!counts || patterns === 1 ? "as many as there must be" : "patterns made at run time: " + patterns);\n`,
  "counts/says-none-where-one-is-made.js": saysNone,
  "counts/is-told-nothing-but-0.js": `// Env: JSC_aotCountsPath=/dev/null
const opened = typeof aotOperationCount === "function" ? aotOperationCount("operationAOTJSONSourceOpen") : 0;
console.log(opened === 0 ? "nothing is parsed" : "parsed: " + opened);
`,
  "counts/asks-in-another-file/main.js": `import "./another-file.js";\n`,
  "counts/asks-in-another-file/another-file.js": saysNone,
  "counts/asks-nothing.js": `console.log("nothing is asked");\n`,
};
const differs = "DIFFERS (exit code 0): -no pattern is made at run time | +patterns made at run time: 1";
const inVain = "ASKS IN VAIN: it names aotOperationCount: each answer was 0";
const names = Object.keys(programs)
  .filter(name => !name.endsWith("/another-file.js"))
  .map(name => name.replace(/(?:\/main)?\.js$/, ""));
const linesOf = (text: string) => text.split("\n").filter(line => line !== "");

if (scriptSkipReason && !unsupported)
  console.error(
    `SKIPPED: test/aot/a-program-that-asks-the-shell-what-it-counted-is-held-to-the-answer.test.ts: ${scriptSkipReason}`,
  );

async function drive(root: string, env: Record<string, string | undefined>) {
  const files = Object.keys(programs).filter(name => !name.endsWith("/another-file.js"));
  const { stdout, stderr, exitCode } = await run(
    [
      bunExe(),
      join(import.meta.dir, "run-parallel.ts"),
      `--root=${root}`,
      "--jobs=4",
      ...files.map(name => join(root, name)),
    ],
    root,
    env,
  );
  const verdicts = Object.fromEntries(
    linesOf(stdout)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state !== "compiling")
      .map(({ file, state, stage, message, shellMs, countsNotAsked }) => [
        file.slice(root.length + 1),
        state !== "pass"
          ? `${stage}: ${message}`
          : countsNotAsked
            ? "pass, not asked"
            : shellMs === undefined
              ? "pass"
              : "pass, asked",
      ]),
  );
  return { verdicts, notAsked: linesOf(stderr).filter(line => line.startsWith("NOT ASKED: ")), exitCode };
}

test.skipIf(!!scriptSkipReason || !isCanary)(
  "by run-parallel.ts",
  async () => {
    using dir = tempDir("asks-the-shell-driver", { "programs/tsconfig.json": "{}" });
    const root = join(String(dir), "programs");
    for (const [name, text] of Object.entries(programs)) await Bun.write(join(root, name), text);
    const { JSC, TESTAOT, FRONT_END } = scriptEnvironment();
    expect(await drive(root, { ...bunEnv, JSC, TESTAOT, FRONT_END })).toEqual({
      verdicts: {
        "counts/says-one-where-one-is-made.js": "pass, asked",
        "counts/says-none-where-one-is-made.js": `count: in the jsc shell: ${differs}`,
        "counts/is-told-nothing-but-0.js": `count: in the jsc shell: ${inVain}`,
        "counts/asks-in-another-file/main.js": `count: in the jsc shell: ${differs}`,
        "counts/asks-nothing.js": "pass",
      },
      notAsked: [],
      exitCode: 1,
    });
    // Without a shell nobody can tell, and nobody says that it holds.
    const { verdicts, notAsked, exitCode } = await drive(root, { ...bunEnv, JSC: "", TESTAOT, FRONT_END });
    expect(verdicts).toEqual({
      "counts/says-one-where-one-is-made.js": "pass, not asked",
      "counts/says-none-where-one-is-made.js": "pass, not asked",
      "counts/is-told-nothing-but-0.js": "pass, not asked",
      "counts/asks-in-another-file/main.js": "pass, not asked",
      "counts/asks-nothing.js": "pass",
    });
    expect(notAsked).toHaveLength(1);
    expect(notAsked[0]).toStartWith(
      "NOT ASKED: 4 programs ask the jsc shell what compiled code did, and there is no jsc shell: ",
    );
    expect(exitCode).toBe(0);
  },
  290_000,
);

test.skipIf(!!scriptSkipReason)(
  "by shell/expectations.py and shell/quick.py",
  async () => {
    using dir = tempDir("asks-the-shell-scripts", {});
    const root = join(String(dir), "programs");
    for (const [name, text] of Object.entries(programs)) await Bun.write(join(root, name), text);
    const env = {
      ...scriptEnvironment(),
      PROGRAMS: root,
      WORK: join(String(dir), "work"),
      KNOWS_SHELL_FUNCTIONS: undefined,
    };

    const expectations = await run([python!, join(import.meta.dir, "shell", "expectations.py"), ...names], root, env);
    expect(expectations.stderr).toBe("");
    expect(linesOf(expectations.stdout)).toEqual([
      "ok   counts/says-one-where-one-is-made: 1 expectations",
      `FAIL counts/says-none-where-one-is-made\tasks aotRuntimeCounters\t${differs}`,
      `FAIL counts/is-told-nothing-but-0\tasks aotOperationCount\t${inVain}`,
      `FAIL counts/asks-in-another-file\tasks aotRuntimeCounters\t${differs}`,
      "ok   counts/asks-nothing: 0 expectations",
      "5 programs, 4 expectation lines: 3 programs fail; 0 lines are known failures",
    ]);
    expect(expectations.exitCode).toBe(1);

    const quick = await run([python!, join(import.meta.dir, "shell", "quick.py"), ...names], root, env);
    expect(quick.stderr).toBe("");
    expect(linesOf(quick.stdout)).toEqual([
      "counts/says-one-where-one-is-made: same (2 lines)",
      `counts/says-none-where-one-is-made: ${differs}`,
      `counts/is-told-nothing-but-0: ${inVain}`,
      `counts/asks-in-another-file: ${differs}`,
      "counts/asks-nothing: same (1 lines)",
    ]);
    expect(quick.exitCode).toBe(1);
  },
  290_000,
);
