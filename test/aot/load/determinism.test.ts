import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

type Files = Record<string, string>;

const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const exe = (name: string) => name + (isWindows ? ".exe" : "");

const BUILD = `import plugins from "./plugins";
const result = await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: process.argv[2], aot: process.argv[3] === "aot" }, plugins, throw: false });
for (const log of result.logs) console.log(String(log));
process.exit(result.success ? 0 : 1);
`;

const PLUGINS = `let calls = 0;
async function late<T>(answer: T): Promise<T> {
  const call = calls++;
  const order = process.env.ORDER;
  if (order) await Bun.sleep(order === "reverse" ? 40 - (call % 40) : call % 7);
  return answer;
}
export default [{ name: "p", setup(b: any) {
b.onLoad({ filter: ${/part\d+\.ts$/} }, async (a: any) => late({ contents: await Bun.file(a.path).text(), loader: "ts" }));
b.onResolve({ filter: ${/^\.\/part\d+$/} }, () => late(undefined));
} }];
`;

const ANSWER_ORDERS: Record<string, string>[] = [
  {},
  { ORDER: "forward" },
  { ORDER: "reverse" },
  { ORDER: "reverse", GOMAXPROCS: "2" },
];

const PART_COUNT = 40;
const LAST_PART = `part${PART_COUNT - 1}.ts`;
// Each part imports only the next one: without these, one plugin request would be in flight at a time.
const PART_IMPORTS = Array.from({ length: PART_COUNT }, (_, index) => `import "./part${index}";\n`).join("");

const PROGRAM: Files = {
  ...Object.fromEntries(
    Array.from({ length: PART_COUNT }, (_, index) => [
      `part${index}.ts`,
      (index + 1 < PART_COUNT
        ? `import { total as next } from "./part${index + 1}";\n`
        : "const next = (n: number): number => n;\n") +
        `export function total(n: number): number {\n  return next(n + ${index});\n}\n`,
    ]),
  ),
  "settings.json": '{ "name": "settings" }\n',
  "limits.toml": "max = 7\n",
  "words.txt": "some words\n",
  "logo.bin": "x".repeat(64),
  "stamp.ts": "export function stamp(name: string) {\n  return { name, list: [1, 2, 3] };\n}\n",
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      resolveJsonModule: true,
      types: [],
      lib: ["esnext", "dom"],
    },
  }),
  "main.ts": `${PART_IMPORTS}import { total } from "./part0";
import settings from "./settings.json";
// @ts-ignore
import limits from "./limits.toml";
// @ts-ignore
import words from "./words.txt";
// @ts-ignore
import logo from "./logo.bin" with { type: "file" };
import { stamp } from "./stamp.ts" with { type: "macro" };
declare const Bun: any;
console.log(total(1), settings.name, limits.max, words.trim(), (await Bun.file(logo).text()).length, JSON.stringify(stamp("a")));
`,
};

const OUTPUT = '781 settings 7 some words 64 {"name":"a","list":[1,2,3]}\n';

const hashOf = async (path: string) => Bun.hash(await Bun.file(path).bytes()).toString(16);

async function buildAndHash(command: string[], folder: string, program: string, env: Record<string, string> = {}) {
  rmSync(program, { force: true });
  const built = await spawned(command, folder, { ...bunEnv, ...env });
  expect({ command, env, ...built }).toEqual({
    command,
    env,
    stdout: expect.any(String),
    stderr: expect.any(String),
    exitCode: 0,
    signal: null,
  });
  return hashOf(program);
}

async function expectOutput(program: string, folder: string) {
  expect(await spawned([program], folder, COMPILED)).toEqual({
    stdout: OUTPUT,
    stderr: expect.any(String),
    exitCode: 0,
    signal: null,
  });
}

const commandLine = (program: string, flags: string[] = []) => [
  bunExe(),
  "build",
  "--compile",
  "--aot",
  ...flags,
  "main.ts",
  "--outfile",
  program,
];

describe.concurrent("compile/aot/load/determinism", () => {
  test(
    "same bytes for any thread count",
    () =>
      slot(async () => {
        using dir = tempDir("aot-determinism", PROGRAM);
        const folder = String(dir);
        const program = join(folder, exe("program"));
        const hashes: string[] = [];
        for (const flags of [[], ["--aot-threads=1"], ["--aot-threads=16"], []]) {
          hashes.push(await buildAndHash(commandLine(program, flags), folder, program));
        }
        expect(hashes).toEqual(hashes.map(() => hashes[0]));
        await expectOutput(program, folder);
      }),
    600_000,
  );

  test(
    "same bytes for any plugin answer order",
    () =>
      slot(async () => {
        using dir = tempDir("aot-determinism", { ...PROGRAM, "build.ts": BUILD, "plugins.ts": PLUGINS });
        const folder = String(dir);
        const program = join(folder, exe("program"));
        const hashes: string[] = [];
        for (const env of ANSWER_ORDERS) {
          hashes.push(await buildAndHash([bunExe(), "build.ts", program, "aot"], folder, program, env));
        }
        expect(hashes).toEqual(hashes.map(() => hashes[0]));
        await expectOutput(program, folder);
      }),
    600_000,
  );

  test(
    "different program, different bytes",
    () =>
      slot(async () => {
        using dir = tempDir("aot-determinism", PROGRAM);
        const folder = String(dir);
        const program = join(folder, exe("program"));
        const original = await buildAndHash(commandLine(program), folder, program);
        const changedText = PROGRAM[LAST_PART].replace(`n + ${PART_COUNT - 1}`, `n + ${PART_COUNT}`);
        expect(changedText).not.toBe(PROGRAM[LAST_PART]);
        writeFileSync(join(folder, LAST_PART), changedText);
        expect(await buildAndHash(commandLine(program), folder, program)).not.toBe(original);
      }),
    600_000,
  );
});
