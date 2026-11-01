import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "path";
import { readBuildReport } from "./harness/build-report";
import { unsupported } from "./harness/compiler";
import { withReport } from "./harness/flags";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";
import { wanted } from "./harness/shares";
import { describe, test } from "./listed";

const copiesOfEachForm = 120;
const fillerFunctions = 14_000;
const fillerFunctionsInFile = 500;
const linesOfFillerFunction = 30;

const forms: ((index: number) => string)[] = [
  index => `
class Held${index} {
  #held = ${index};
  static made = 0;
  get held() { return this.#held; }
  set held(value: number) { this.#held = value; }
  plus(a: number) { Held${index}.made++; return this.#held + a; }
}
forms.push(function privateFields${index}(a: number): number {
  const object = new Held${index}();
  object.held = object.held + a;
  return object.plus(Held${index}.made);
});`,
  index => `
class Base${index} { constructor(public size: number) {} area(): number { return this.size; } name(): string { return "base"; } }
class Square${index} extends Base${index} { area(): number { return super.area() * this.size; } name(): string { return "square" + super.name(); } }
class Cube${index} extends Square${index} { area(): number { return super.area() * 6; } }
forms.push(function overriddenMethods${index}(a: number): number {
  const all: Base${index}[] = [new Base${index}(a), new Square${index}(a + 1), new Cube${index}(${(index % 5) + 1})];
  let sum = 0;
  for (const one of all) sum += one.area() + one.name().length;
  return sum;
});`,
  index => `
forms.push(function closuresHandedToArrayMethods${index}(a: number): number {
  let calls = 0;
  const count = <T,>(value: T): T => { calls++; return value; };
  const list = Array.from({ length: ${(index % 7) + 3} }, (_, at) => count(at * a + ${index}));
  return list.filter(value => count(value) % 2 === 0).map(value => value + calls).reduce((sum, value) => sum + value, calls);
});`,
  index => `
async function later${index}(value: number): Promise<number> { await null; return value + ${index}; }
forms.push(async function awaits${index}(a: number): Promise<number> {
  const [first, second] = await Promise.all([later${index}(a), later${index}(a + 1)]);
  let sum = first * 3 + second;
  for await (const value of [later${index}(1), 2, Promise.resolve(3)]) sum += value;
  return sum;
});`,
  index => `
function* upTo${index}(end: number): Generator<number, string, number | undefined> {
  let sent = 0;
  for (let at = 0; at < end; at++) sent += (yield at + ${index}) ?? 0;
  return "sent" + sent;
}
forms.push(function generators${index}(a: number): number {
  const steps = upTo${index}(3);
  let sum = [...upTo${index}(${(index % 4) + 1})].length;
  for (let step = steps.next(); ; step = steps.next(a)) {
    if (step.done) return sum + step.value.length;
    sum += step.value;
  }
});`,
  index => `
class Refused${index} extends Error { constructor(public code: number) { super("refused " + code); this.name = "Refused${index}"; } }
forms.push(function errorsCaught${index}(a: number): number {
  let sum = 0;
  for (const what of [() => { throw new Refused${index}(a); }, () => (null as any).member, () => ${index}, () => { throw a; }]) {
    try { sum += what() as number; }
    catch (error) { sum += error instanceof Refused${index} ? error.code + error.message.length : error instanceof TypeError ? 7 : (error as number) * 2; }
    finally { sum++; }
  }
  return sum;
});`,
  index => `
interface Box${index} { width: number; height: number; label: string }
function describeBox${index}(box: Box${index}): string { return box.label + box.width * box.height; }
byName["describe" + ${index}] = describeBox${index};
forms.push(function declaredTypesThatDoNotHold${index}(a: number): number {
  const describe = byName["de" + "scribe" + (${index} + a - a)];
  return (String(describe({ width: a, height: 2, label: "box" })) + describe({ width: "3", height: [a], label: ${index} }) + describe({ height: a })).length;
});`,
  index => `
forms.push(function mapsAndSets${index}(a: number): number {
  const seen = new Set<string>(["a", "b${index}"]);
  const counts = new Map<string, number>([["a", a]]);
  for (const key of ["a", "b${index}", "c", "a"]) {
    counts.set(key, (counts.get(key) ?? 0) + (seen.has(key) ? 2 : 1));
    seen.add(key + counts.size);
  }
  let sum = seen.size;
  for (const [key, value] of counts) sum += key.length * value;
  return sum;
});`,
  index => `
forms.push(function texts${index}(a: number): number {
  let text = "";
  for (let at = 0; at < ${(index % 6) + 2}; at++) text += at % 2 ? "x" + a : \`<\${at}|${index}>\`;
  const parsed = JSON.parse(JSON.stringify({ text, list: [a, "${index}", null], deep: { a } })) as { text: string; list: unknown[]; deep: { a: number } };
  return parsed.text.replace(/\\d+/g, digits => String(digits.length)).length + parsed.list.length + parsed.deep.a + text.split("|").length + text.indexOf("x");
});`,
  index => `
forms.push(function patterns${index}(a: number, { scale = ${(index % 3) + 1}, ...others }: { scale?: number; [key: string]: unknown } = { extra: a }, ...rest: number[]): number {
  const [first = 5, , third = first, ...more] = [a || undefined, 1, undefined, 4, 5];
  const holder: { inner?: { value?: number; read?(): number } } = a % 2 ? { inner: { value: a, read() { return this.value! + 1; } } } : {};
  return first * scale + third + more.length + Object.keys(others).length + rest.length + (holder.inner?.value ?? -1) + (holder.inner?.read?.() ?? -2);
});`,
  index => `
type Kind${index} = "circle" | "line" | "dot${index}";
function weigh${index}(kind: Kind${index}, size: number): number {
  switch (kind) {
    case "circle": return size * 3;
    case "line": return size;
    case "dot${index}": return 1;
  }
}
byName["weigh" + ${index}] = weigh${index};
forms.push(function literalTypes${index}(a: number): number {
  let sum = 0;
  for (const kind of ["circle", "line", "dot${index}", "none"]) sum += Number(byName["weigh${index}"](kind, a) ?? 100);
  return sum;
});`,
  index => `
forms.push(function keysOfObjects${index}(a: number): number {
  const object: Record<string, unknown> = { a, get twice() { return (this.a as number) * 2; }, ["k" + ${index}]: "v", 3: true };
  object["late" + a] = ${index};
  delete object.a;
  let sum = 0;
  for (const key in object) sum += key.length;
  for (const [key, value] of Object.entries(object)) sum += key.length + String(value).length;
  return sum + Object.keys(object).indexOf("twice");
});`,
];

const shared = `export const forms: ((a: number, ...rest: any[]) => number | Promise<number>)[] = [];
export const byName: Record<string, (...values: any[]) => unknown> = {};
`;
const coreFiles = Object.fromEntries(
  forms.map((form, number) => [
    `core${number}.ts`,
    `import { byName, forms } from "./shared.ts";\nvoid byName;\n${Array.from({ length: copiesOfEachForm }, (_, index) => form(index)).join("\n")}\n`,
  ]),
);
const runCore = `${forms.map((_, number) => `import "./core${number}.ts";`).join("\n")}
import { forms } from "./shared.ts";
export async function runCore(): Promise<void> {
  let sum = 0;
  const byForm = new Map<string, number>();
  for (let turn = 0; turn < 3; turn++) {
    for (const form of forms) {
      const answer = await form(turn + 1);
      const name = form.name.replace(/\\d+$/, "");
      byForm.set(name, ((byForm.get(name) ?? 0) * 31 + answer) | 0);
      sum = (sum * 31 + answer) | 0;
    }
  }
  await new Promise<void>(resolve => setTimeout(async () => { for (const form of forms) sum = (sum + (await form(9))) | 0; resolve(); }, 0));
  for (const [name, value] of byForm) console.log(name, value);
  console.log("core", forms.length, sum);
}
`;

function fillerFile(file: number): string {
  let text = "";
  const names: string[] = [];
  for (
    let index = file * fillerFunctionsInFile;
    index < Math.min(fillerFunctions, (file + 1) * fillerFunctionsInFile);
    index++
  ) {
    let body = "";
    for (let line = 0; line < linesOfFillerFunction; line++)
      body += `  x = (x * ${((index + line) % 97) + 3} + (y ^ ${line + 1})) | 0; y = (y + (x >>> ${(line % 13) + 1})) | 0;\n`;
    text += `function filler${index}(x, y) {\n${body}  return x ^ y;\n}\n`;
    names.push(`filler${index}`);
  }
  return `${text}export const fillers${file} = [${names.join(", ")}];\n`;
}
const numberOfFillerFiles = Math.ceil(fillerFunctions / fillerFunctionsInFile);
const fillerFiles = Object.fromEntries(
  Array.from({ length: numberOfFillerFiles }, (_, file) => [`filler${file}.js`, fillerFile(file)]),
);

describe.skipIf(!!unsupported || wanted === "quick" || isASAN || isDebug)(
  "a program of five million operations is built as a very large one",
  () => {
    setDefaultTimeout(1_200_000);
    const { folder, build } = sharedBuilds("a-program-of-five-million-operations", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          allowJs: true,
          noEmit: true,
        },
      }),
      "shared.ts": shared,
      ...coreFiles,
      "run-core.ts": runCore,
      ...fillerFiles,
      "small.ts": `import { runCore } from "./run-core.ts";\nawait runCore();\n`,
      "large.ts": `import { runCore } from "./run-core.ts";
${Array.from({ length: numberOfFillerFiles }, (_, file) => `import { fillers${file} } from "./filler${file}.js";`).join("\n")}
await runCore();
let sum = 0;
for (const list of [${Array.from({ length: numberOfFillerFiles }, (_, file) => `fillers${file}`).join(", ")}]) for (const filler of list) sum = (sum + filler(sum, list.length)) | 0;
console.log("filler", sum);
`,
    });
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run(cmd, folder, bunEnv);
      return { stdout, exitCode };
    };
    const estimatesOfVeryLargeProgram = async (entry: string) => {
      const report = join(folder, entry + ".report.json");
      const built = await build(entry, "--aot", ...withReport(report, "summary"));
      return { built, estimates: readBuildReport(report).statistics.HeatEstimatesOfVeryLargeProgram };
    };

    test("by its size alone, and it prints what plain Bun prints", async () => {
      const { built, estimates } = await estimatesOfVeryLargeProgram("large.ts");
      expect(estimates).toBeGreaterThan(0);
      expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), "large.ts"]));
    });

    test("the core by itself is an ordinary program, and prints the same", async () => {
      const { built, estimates } = await estimatesOfVeryLargeProgram("small.ts");
      expect(estimates).toBe(0);
      expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), "small.ts"]));
    });
  },
);
