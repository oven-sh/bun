// `--explain` names the line where a value of unknown type begins, however many reads, calls and operators in however many functions and files hang on it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import type { ExplainCause } from "./explain/explain-report";
import { parseExplainLines } from "./explain/explain-report";
import { run } from "./harness/run";
import { describe, test } from "./supported";

async function explain(files: Record<string, string>) {
  using dir = tempDirWithBunTypes("aot-explain-roots", files);
  const { stdout, exitCode } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", "--explain=json", "main.ts"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  return { ...parseExplainLines(stdout), exitCode };
}

const placeOf = ({ file, line, reason }: ExplainCause) => `${file}:${line} ${reason}`;
const operationsOf = (cause: ExplainCause) => cause.accesses + cause.calls + cause.operators;

describe.concurrent("one line, many operations", () => {
  test("five hundred reads in ten files hang on one JSON.parse", async () => {
    const files: Record<string, string> = {
      "settings.ts": `export const settings: any = JSON.parse(process.argv[2] ?? '{ "a": { "b": { "c": 1 } } }');\n`,
    };
    let main = "";
    for (let file = 0; file < 10; file++) {
      let text = `import { settings } from "./settings";\n`;
      for (let index = 0; index < 10; index++) {
        text += `export function read${index}(from: any) {\n  const inner = from.a;\n  return inner.b.c + from.a.b.c;\n}\n`;
      }
      text += `export function all() {\n  let sum = 0;\n`;
      for (let index = 0; index < 10; index++) text += `  sum += read${index}(settings);\n`;
      files[`part${file}.ts`] = text + `  return sum;\n}\n`;
      main += `import { all as all${file} } from "./part${file}";\nconsole.log(all${file}());\n`;
    }
    files["main.ts"] = main;

    const { causes, numbers, exitCode } = await explain(files);
    const untyped = numbers.accesses.byName + numbers.accesses.tested;
    expect({ exitCode, first: placeOf(causes[0]), untyped: untyped >= 500 }).toEqual({
      exitCode: 0,
      first: "settings.ts:1 unknown-object",
      untyped: true,
    });
    expect(causes[0].accesses).toBeGreaterThanOrEqual(500);
    expect(causes[0].operators).toBeGreaterThanOrEqual(100);
    expect(causes[0].fixedByThisAlone).toBe(operationsOf(causes[0]));
    expect(causes[0].estimatedPercent).toBeGreaterThan(90);
  }, 120_000);

  test("what a function is given by code outside the program begins where the function was handed over", async () => {
    const { causes, exitCode } = await explain({
      "main.ts": `const handlers = {
  open(event: any) {
    return event.target.name;
  },
  close(event: any) {
    return event.target.code;
  },
};
(globalThis as any)[process.argv[2] ?? "handlers"] = handlers;
console.log((globalThis as any).handlers.open({ target: { name: "a" } }));
`,
    });
    const inHandlers = causes.filter(cause => cause.line >= 2 && cause.line <= 7 && cause.accesses > 0);
    const atTheStore = causes.filter(cause => cause.reason === "called-by-unknown-code" && cause.accesses >= 4);
    expect({ exitCode, inHandlers: inHandlers.map(placeOf), atTheStore: atTheStore.map(placeOf) }).toEqual({
      exitCode: 0,
      inHandlers: [],
      atTheStore: ["main.ts:9 called-by-unknown-code"],
    });
  }, 60_000);

  test("tests, comparisons, arithmetic and calls on a value of unknown type count for the line it comes from", async () => {
    const { causes, exitCode } = await explain({
      "main.ts": `const input: any = JSON.parse(process.argv[2] ?? '{ "count": 1, "name": "a", "run": null }');
function use(value: any) {
  let result = 0;
  if (value.count) result += 1;
  if (value.name === value.other) result += 2;
  result += value.count * 2;
  if (value.count < value.limit) result += 3;
  if (typeof value.run === "function") result += value.run();
  return result;
}
let total = 0;
for (let i = 0; i < 1000; i++) total += use(input);
console.log(total);
`,
    });
    expect({ exitCode, first: placeOf(causes[0]) }).toEqual({ exitCode: 0, first: "main.ts:1 unknown-object" });
    expect(causes[0].operators).toBeGreaterThanOrEqual(2);
    expect(causes.some(cause => cause.line === 1 && cause.calls > 0)).toBe(true);
  }, 60_000);

  test("a few reads in a loop rank above many that run once", async () => {
    let once = "";
    for (let index = 0; index < 60; index++) once += `console.log(cold.field${index});\n`;
    const { causes, exitCode } = await explain({
      "main.ts": `const cold: any = JSON.parse(process.argv[2] ?? "{}");
const hot: any = JSON.parse(process.argv[3] ?? '{ "x": 1, "y": 2 }');
${once}
function step(point: any) {
  return point.x + point.y;
}
let total = 0;
for (let i = 0; i < 1000; i++) for (let j = 0; j < 1000; j++) total += step(hot);
console.log(total);
`,
    });
    expect({ exitCode, order: causes.slice(0, 2).map(placeOf) }).toEqual({
      exitCode: 0,
      order: ["main.ts:2 unknown-object", "main.ts:1 unknown-object"],
    });
    expect(causes[0].accesses).toBeLessThan(causes[1].accesses);
    expect(causes[0].estimatedPercent).toBeGreaterThan(causes[1].estimatedPercent);
  }, 60_000);

  test("an operation that two lines keep untyped says so", async () => {
    const { causes, exitCode } = await explain({
      "main.ts": `const first: any = JSON.parse(process.argv[2] ?? '{ "x": 1 }');
const second: any = JSON.parse(process.argv[3] ?? '{ "x": 2 }');
function read(value: any) {
  return value.x;
}
console.log(read(first) + read(second));
`,
    });
    const ofRead = causes.filter(cause => cause.reason === "unknown-object");
    expect({ exitCode, alone: ofRead.map(cause => cause.fixedByThisAlone) }).toEqual({ exitCode: 0, alone: [0] });
  }, 60_000);
});
