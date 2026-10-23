import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, unsupported } from "./run-programs";

const program = `const make = (async function () {}).constructor;
try {
  console.log("answer:", await make(process.argv[2])());
} catch (error) {
  console.log("caught:", error.name, error.code);
}
`;
const notFound = "caught: Error ERR_MODULE_NOT_FOUND";
const snippets: [name: string, code: string, untrimmed: string, trimmed: string][] = [
  [
    "that uses only the language",
    `return [1, 2].map(x => x * 2).join() + /a+/.test("aa")`,
    "answer: 2,4true",
    "answer: 2,4true",
  ],
  [
    "that creates a generator function from a string",
    `return [...(function* () {}).constructor("yield 1; yield 2")()].join()`,
    "answer: 1,2",
    "answer: 1,2",
  ],
  ["that imports a file: module not found", `return (await import("./late.ts")).default`, notFound, notFound],
  [
    "that imports a built-in module that the program also imports",
    `return typeof (await import("node:path")).join`,
    "answer: function",
    "answer: function",
  ],
  [
    "that imports a built-in module that the program never imports: module not found",
    `return typeof (await import("node:zlib")).gzipSync`,
    notFound,
    notFound,
  ],
  [
    "that imports a native built-in module that the program never imports: module not found",
    `return typeof (await import("node:sqlite")).DatabaseSync`,
    "answer: function",
    notFound,
  ],
  [
    "that imports bun:jsc, which the program never imports: module not found",
    `return typeof (await import("bun:jsc")).heapStats`,
    "answer: function",
    notFound,
  ],
];

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({
    cmd,
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

using probe = tempDir("evaluated-code-probe", { "hello.ts": "console.log(1);" });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--trim", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stderr: "pipe",
});

(probed.exitCode !== 0 || unsupported || isWindows ? describe.skip : describe)(
  "code evaluated through the constructor of an async function",
  () => {
    const importsAModule = ([, code]: (typeof snippets)[number]) => code.includes("import(");

    function expectAnswers(chosen: typeof snippets) {
      return slot(async () => {
        using dir = tempDir("evaluated-code", {
          "program.mjs": program,
          "late.ts": `export default "late" as string;\n`,
        });
        const found: Record<string, unknown> = {};
        for (const [kind, flags] of [
          ["untrimmed", []],
          ["trimmed", ["--trim"]],
        ] as const) {
          const build = await run(
            [bunExe(), "build", "--compile", "--aot", "--explain=trim", ...flags, "program.mjs", "--outfile", kind],
            String(dir),
          );
          expect({ opens: /^aot: trim: blocked by eval\b/m.test(build.stderr), exitCode: build.exitCode }).toEqual({
            opens: true,
            exitCode: 0,
          });
          for (const [name, code] of chosen) {
            const ran = await run([join(String(dir), kind), code], String(dir));
            found[`${kind}: code ${name}`] = `${ran.stdout.trim()}, exit ${ran.exitCode}`;
          }
        }
        expect(found).toEqual(
          Object.fromEntries(
            chosen.flatMap(([name, , untrimmed, trimmed]) => [
              [`untrimmed: code ${name}`, `${untrimmed}, exit 0`],
              [`trimmed: code ${name}`, `${trimmed}, exit 0`],
            ]),
          ),
        );
      });
    }

    test(
      "evaluated code can use all of JavaScript",
      () => expectAnswers(snippets.filter(each => !importsAModule(each))),
      600_000,
    );

    test(
      "evaluated code can import the modules that the program imports, and gets a catchable error for what was left out",
      () => expectAnswers(snippets.filter(importsAModule)),
      600_000,
    );
  },
);
