import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [] },
});

type Place = { file?: string; line?: number; column?: number; message: string };
type Finding = Place & { rule: string; severity: string; code: number; because: (Place & { code: number })[] };

const at = (place: Place) => (place.file ? `${place.file}:${place.line}:${place.column} ` : "");
const shown = (finding: Finding) => [`${finding.severity} ${finding.rule} TS${finding.code} ${at(finding)}${finding.message}`, ...finding.because.map(reason => `  ${at(reason)}${reason.message}`)];

async function run(cmd: string[], files: Record<string, string>) {
  using dir = tempDir("aot-diagnostic-rules", { "tsconfig.json": tsconfig, ...files });
  await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd: String(dir), env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, wroteExecutable: existsSync(join(String(dir), isWindows ? "app.exe" : "app")) };
}

async function check(files: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run(["check", "--aot", "--no-pretty", "--aot-explain=rules-json", ...flags, "main.ts"], files);
  const findings = stdout.split("\n").filter(line => line.startsWith('{"rule"'));
  return { findings: findings.flatMap(line => shown(JSON.parse(line))), stdout, stderr, exitCode };
}

const build = (files: Record<string, string>, ...flags: string[]) => run(["build", "--compile", "--aot", ...flags, "main.ts", "--outfile", "app"], files);

const openPoint = {
  "main.ts": `interface Point {
  x: number;
  y: number;
}
interface Size {
  width: number;
}
function fromAnywhere(value: any): Point {
  return value;
}
const made: Point = { x: 1, y: 2 };
const size: Size = { width: 3 };
const other = fromAnywhere({ x: 3, y: 4 });
export const sum = made.x + other.y + size.width;
`,
};
const pointIsOpen = (severity: string) => [
  `${severity} open-layout TS100022 main.ts:1:11 'Point' can hold objects that typed code did not create, so every property access through it checks the object first.`,
  "  main.ts:9:10 A value of type 'any' or 'unknown' is assigned to it here.",
];

const packageWithTypeError = {
  "main.ts": `import { thrice } from "typed";\nexport const nine = thrice(3);\n`,
  "node_modules/typed/package.json": `{ "name": "typed", "version": "1.0.0", "main": "index.ts" }`,
  "node_modules/typed/index.ts": `export function thrice(n: number): number { const text: string = n; return n * 3; }\n`,
};

describe.concurrent("severities", () => {
  test("every rule but untyped-file is off by default", async () => {
    expect(await check(openPoint)).toMatchObject({ findings: [], exitCode: 0 });
  }, 60_000);

  test("--aot-warn reports and succeeds", async () => {
    expect(await check(openPoint, "--aot-warn=open-layout")).toMatchObject({ findings: pointIsOpen("warn"), exitCode: 0 });
  }, 60_000);

  test("--aot-deny reports and fails", async () => {
    expect(await check(openPoint, "--aot-deny=open-layout")).toMatchObject({ findings: pointIsOpen("deny"), exitCode: 1 });
  }, 60_000);

  test("all names every rule", async () => {
    expect(await check(openPoint, "--aot-deny=all")).toMatchObject({ findings: pointIsOpen("deny"), exitCode: 1 });
  }, 60_000);

  test("of two flags that name a rule, the later one counts", async () => {
    expect(await check(openPoint, "--aot-deny=all", "--aot-allow=open-layout")).toMatchObject({ findings: [], exitCode: 0 });
    expect(await check(openPoint, "--aot-allow=open-layout", "--aot-deny", "all")).toMatchObject({ findings: pointIsOpen("deny"), exitCode: 1 });
    expect(await check(openPoint, "--aot-deny=open-layout", "--aot-warn=lost-layout,open-layout")).toMatchObject({ findings: pointIsOpen("warn"), exitCode: 0 });
  }, 60_000);

  test("without --pretty the reasons are indented under the finding", async () => {
    const { stdout } = await run(["check", "--aot", "--no-pretty", "--aot-deny=open-layout", "main.ts"], openPoint);
    expect(stdout).toStartWith(
      "main.ts(1,11): error TS100022: 'Point' can hold objects that typed code did not create, so every property access through it checks the object first. [open-layout]\n" +
        "  main.ts(9,10): A value of type 'any' or 'unknown' is assigned to it here.\n",
    );
  }, 60_000);

  test("a denied rule fails the build, and nothing is written", async () => {
    const { stderr, exitCode, wroteExecutable } = await build(openPoint, "--aot-deny=open-layout");
    expect(stderr).toContain("error: TS100022: 'Point' can hold objects that typed code did not create, so every property access through it checks the object first. [open-layout]");
    expect(stderr).toContain("note: TS100040: A value of type 'any' or 'unknown' is assigned to it here.");
    expect({ exitCode, wroteExecutable }).toEqual({ exitCode: 1, wroteExecutable: false });
  }, 120_000);

  test("a rule that warns does not", async () => {
    const { stderr, exitCode, wroteExecutable } = await build(openPoint, "--aot-warn=open-layout");
    expect(stderr).toContain("warn: TS100022: 'Point' can hold objects");
    expect({ exitCode, wroteExecutable }).toEqual({ exitCode: 0, wroteExecutable: true });
  }, 120_000);
});

describe.concurrent("flags", () => {
  test.each([
    [["check", "--aot", "--aot-deny=open-layouts", "main.ts"], 'error: --aot-deny does not take "open-layouts". Did you mean open-layout? The rules are untyped-file, untyped-package, lost-layout, untyped-base, open-layout, interpreted, all\n'],
    [["build", "--compile", "--aot", "--aot-warn=nothing-like-it", "main.ts", "--outfile", "app"], 'error: --aot-warn does not take "nothing-like-it". The rules are untyped-file, untyped-package, lost-layout, untyped-base, open-layout, interpreted, all\n'],
    [["check", "--aot-deny=all", "main.ts"], "error: --aot-deny requires --aot\n"],
    [["build", "--compile", "--aot-allow=all", "main.ts", "--outfile", "app"], "error: --aot-allow requires --aot\n"],
  ])("bun %j", async (cmd, message) => {
    const { stderr, exitCode, wroteExecutable } = await run(cmd, openPoint);
    expect({ said: stderr.split("\n")[0] + "\n", exitCode, wroteExecutable }).toEqual({ said: message, exitCode: 1, wroteExecutable: false });
  }, 60_000);
});

describe.concurrent("scopes", () => {
  const twoFiles = {
    "main.ts": `import { readSize } from "./src/size";\n${openPoint["main.ts"]}export const width = readSize({ width: 1 }).width;\n`,
    "src/size.ts": `export interface Box {\n  width: number;\n}\nexport const unit: Box = { width: 1 };\nexport function readSize(value: any): Box {\n  return value;\n}\n`,
  };
  const boxIsOpen = (severity: string) => [
    `${severity} open-layout TS100022 src/size.ts:1:18 'Box' can hold objects that typed code did not create, so every property access through it checks the object first.`,
    "  src/size.ts:6:10 A value of type 'any' or 'unknown' is assigned to it here.",
  ];

  test("rule:pattern limits a rule to the files that match", async () => {
    expect(await check(twoFiles, "--aot-deny=open-layout:src/**")).toMatchObject({ findings: boxIsOpen("deny"), exitCode: 1 });
    expect(await check(twoFiles, "--aot-deny=open-layout:src")).toMatchObject({ findings: boxIsOpen("deny"), exitCode: 1 });
    expect(await check(twoFiles, "--aot-deny=open-layout:lib/**")).toMatchObject({ findings: [], exitCode: 0 });
    expect(await check(twoFiles, "--aot-deny=open-layout", "--aot-allow=open-layout:main.ts")).toMatchObject({ findings: boxIsOpen("deny"), exitCode: 1 });
  }, 120_000);

  test("// @aot-strict before a declaration denies every rule inside it", async () => {
    const files = { "main.ts": openPoint["main.ts"].replace("interface Point", "export {};\n// @aot-strict\ninterface Point") };
    expect(await check(files)).toMatchObject({
      findings: [pointIsOpen("deny")[0].replace("main.ts:1:11", "main.ts:3:11"), pointIsOpen("deny")[1].replace("main.ts:9:10", "main.ts:11:10")],
      exitCode: 1,
    });
  }, 60_000);

  test("// @aot-strict before the first statement denies every rule in the file", async () => {
    const files = { ...twoFiles, "src/size.ts": "// @aot-strict\n" + twoFiles["src/size.ts"] };
    expect(await check(files)).toMatchObject({
      findings: [boxIsOpen("deny")[0].replace("size.ts:1:18", "size.ts:2:18"), boxIsOpen("deny")[1].replace("size.ts:6:10", "size.ts:7:10")],
      exitCode: 1,
    });
  }, 60_000);

  test("// @aot-allow turns rules off for one declaration", async () => {
    const files = { "main.ts": openPoint["main.ts"].replace("interface Point", "export {};\n// @aot-allow lost-layout, open-layout\ninterface Point") };
    expect(await check(files, "--aot-deny=all")).toMatchObject({ findings: [], exitCode: 0 });
    const others = { "main.ts": openPoint["main.ts"].replace("interface Point", "export {};\n// @aot-allow lost-layout\ninterface Point") };
    expect((await check(others, "--aot-deny=all")).exitCode).toBe(1);
  }, 60_000);
});

describe.concurrent("bunfig.toml", () => {
  test("[aot] sets severities for bun check --aot and for a build", async () => {
    const files = { ...openPoint, "bunfig.toml": `[aot]\ndeny = ["open-layout"]\n` };
    expect(await check(files)).toMatchObject({ findings: pointIsOpen("deny"), exitCode: 1 });
    expect(await build(files)).toMatchObject({ exitCode: 1, wroteExecutable: false });
  }, 120_000);

  test("a flag overrides the file", async () => {
    const files = { ...openPoint, "bunfig.toml": `[aot]\ndeny = ["all"]\n` };
    expect(await check(files, "--aot-warn=open-layout")).toMatchObject({ findings: pointIsOpen("warn"), exitCode: 0 });
  }, 60_000);

  test("[[aot.overrides]] limits settings to files", async () => {
    const overrides = (pattern: string) => ({ ...openPoint, "bunfig.toml": `[aot]\nwarn = ["open-layout"]\n\n[[aot.overrides]]\nfiles = ["${pattern}"]\ndeny = ["open-layout"]\n` });
    expect(await check(overrides("main.ts"))).toMatchObject({ findings: pointIsOpen("deny"), exitCode: 1 });
    expect(await check(overrides("src/**"))).toMatchObject({ findings: pointIsOpen("warn"), exitCode: 0 });
  }, 60_000);

  test("an unknown rule in the file is an error", async () => {
    const { stderr, exitCode } = await check({ ...openPoint, "bunfig.toml": `[aot]\nwarn = ["open-layuot"]\n` });
    expect({ said: stderr.split("\n")[0], exitCode }).toEqual({
      said: 'error: aot.warn in bunfig.toml does not take "open-layuot". Did you mean open-layout? The rules are untyped-file, untyped-package, lost-layout, untyped-base, open-layout, interpreted, all',
      exitCode: 1,
    });
  }, 60_000);
});

describe.concurrent("untyped-file", () => {
  const found = (severity: string, dir = "") => [
    expect.stringMatching(new RegExp(`^${severity} untyped-file TS100009 'typed' has 1 type errors, the first at .*node_modules[\\\\/]typed[\\\\/]index\\.ts:1:51: it is compiled untyped\\.$`)),
    `  ${dir}node_modules/typed/index.ts:1:51 Type 'number' is not assignable to type 'string'.`,
  ];

  test("warns by default, in bun check --aot as in a build", async () => {
    expect(await check(packageWithTypeError)).toMatchObject({ findings: found("warn"), exitCode: 0 });
    const { stderr, exitCode, wroteExecutable } = await build(packageWithTypeError);
    expect(stderr).toContain("warn: TS100009: 'typed' has 1 type errors");
    expect(stderr).toContain("it is compiled untyped. [untyped-file]");
    expect({ exitCode, wroteExecutable }).toEqual({ exitCode: 0, wroteExecutable: true });
  }, 120_000);

  test("can be denied", async () => {
    expect(await check(packageWithTypeError, "--aot-deny=untyped-file")).toMatchObject({ findings: found("deny"), exitCode: 1 });
    expect(await build(packageWithTypeError, "--aot-deny=untyped-file")).toMatchObject({ exitCode: 1, wroteExecutable: false });
  }, 120_000);

  test("can be allowed", async () => {
    expect(await check(packageWithTypeError, "--aot-allow=untyped-file")).toMatchObject({ findings: [], exitCode: 0 });
  }, 60_000);

  test("a package without type errors is not reported", async () => {
    const files = { ...packageWithTypeError, "node_modules/typed/index.ts": "export function thrice(n: number): number { return n * 3; }\n" };
    expect(await check(files, "--aot-deny=all")).toMatchObject({ findings: [], exitCode: 0 });
  }, 60_000);
});

describe.concurrent("untyped-package", () => {
  const files = {
    "main.ts": `import { twice } from "plain";\nexport const four = twice(2);\n`,
    "node_modules/plain/package.json": `{ "name": "plain", "version": "1.0.0", "main": "index.js", "types": "index.d.ts" }`,
    "node_modules/plain/index.js": "exports.twice = function (n) { return n * 2; };\n",
    "node_modules/plain/index.d.ts": "export declare function twice(n: number): number;\n",
  };

  test("a JavaScript dependency is reported where it is imported", async () => {
    const { stderr, exitCode, wroteExecutable } = await build(files, "--aot-deny=untyped-package");
    expect(stderr).toMatch(/^error: TS100026: 'plain' is JavaScript, so it is compiled without types: 1 file, \d+\.\d% of the program's source text\. \[untyped-package\]$/m);
    expect(stderr).toMatch(/^ +at .*main\.ts:1:1$/m);
    expect({ exitCode, wroteExecutable }).toEqual({ exitCode: 1, wroteExecutable: false });
  }, 120_000);

  test("a TypeScript dependency is not", async () => {
    const typed = { ...packageWithTypeError, "node_modules/typed/index.ts": "export function thrice(n: number): number { return n * 3; }\n" };
    expect(await build(typed, "--aot-deny=untyped-package")).toMatchObject({ exitCode: 0, wroteExecutable: true });
  }, 120_000);
});

describe.concurrent("lost-layout", () => {
  const noLayout = (name: string, place: string) => `deny lost-layout TS100023 main.ts:${place} Class '${name}' has no fixed layout, so its instances are compiled as untyped objects.`;

  test.each([
    [
      "a class in a function",
      `function makeRow(value: number) {\n  class Row {\n    value = value;\n  }\n  return new Row();\n}\nexport const row = makeRow(1).value;\n`,
      [noLayout("Row", "2:9"), "  main.ts:1:10 It is declared inside this function, so a new class is created each time the function runs."],
    ],
    [
      "a class in a loop",
      `export const made: object[] = [];\nfor (let i = 0; i < 2; i++) {\n  made.push(new (class Turn {\n    index = i;\n  })());\n}\n`,
      [noLayout("Turn", "3:24"), "  main.ts:2:1 It is declared inside this loop, so a new class is created on every iteration."],
    ],
    [
      "a constructor that does not call super() first",
      `class Base {\n  id = 1;\n}\nclass Early extends Base {\n  extra: number;\n  constructor(flag: boolean) {\n    if (flag) {\n      super();\n    } else {\n      super();\n    }\n    this.extra = 2;\n  }\n}\nexport const extra = new Early(true).extra;\n`,
      [noLayout("Early", "4:7"), "  main.ts:6:3 This constructor can use 'this' or return before 'super()' has returned."],
    ],
    [
      "a subclass of such a class",
      `function makeBase() {\n  return class Inner {\n    id = 1;\n  };\n}\nconst Made = makeBase();\nclass Outer extends Made {\n  extra = 2;\n}\nexport const extra = new Outer().extra;\n`,
      [
        noLayout("Inner", "2:16"),
        "  main.ts:1:10 It is declared inside this function, so a new class is created each time the function runs.",
        noLayout("Outer", "7:7"),
        "  main.ts:7:21 Its base class 'Inner' has no fixed layout.",
        "  main.ts:1:10 It is declared inside this function, so a new class is created each time the function runs.",
      ],
    ],
    [
      "a base class that is one of two",
      `class Base {\n  id = 1;\n}\nclass Other {\n  id = 2;\n}\nconst Picked = Math.random() < 2 ? Base : Other;\nclass Chosen extends Picked {\n  extra = 3;\n}\nexport const extra = new Chosen().extra;\n`,
      [noLayout("Chosen", "8:7"), "  main.ts:8:22 This base class is not the name of one class declaration."],
    ],
    [
      "a property that Object.defineProperty can redefine",
      `class Redefined {\n  count = 0;\n}\nObject.defineProperty(Redefined.prototype, "count", { get: () => 1, set() {} });\nexport const count = new Redefined().count;\n`,
      [noLayout("Redefined", "1:7"), "  main.ts:4:1 This call can redefine a property of its instances."],
    ],
    [
      "a private name test on a class whose constructor lets this escape",
      `class Marked {\n  #secret = 1;\n  constructor(sink: (value: unknown) => void) {\n    sink(this);\n  }\n  static is(value: object) {\n    return #secret in value;\n  }\n}\nexport const marked = Marked.is(new Marked(() => {}));\n`,
      [noLayout("Marked", "1:7"), "  main.ts:7:12 This tests an object for a private name of the class, and 'this' escapes while an instance is constructed."],
    ],
    [
      "declared fields beside a computed method name that is not a constant",
      `function pick(): string {\n  return Math.random() < 2 ? "describe" : "other";\n}\nconst dynamicName = pick();\nclass Fiber {\n  declare id: number;\n  declare steps: number;\n  constructor() {\n    this.id = 1;\n    this.steps = 0;\n  }\n  [dynamicName]() {\n    return this.id;\n  }\n}\nexport const steps = new Fiber().steps;\n`,
      [
        "deny lost-layout TS100024 main.ts:5:7 Class 'Fiber' leaves declared fields out of its layout, so every access to them is a lookup by name: id, steps.",
        "  main.ts:12:4 The name of this member is computed and is not a constant, so it could be the name of any field.",
      ],
    ],
  ])("%s", async (_, source, findings) => {
    expect(await check({ "main.ts": source }, "--aot-deny=lost-layout")).toMatchObject({ findings, exitCode: 1 });
  }, 60_000);

  test.each([
    ["a class at the top level", `class Fine {\n  x = 1;\n  y = 2;\n}\nexport const x = new Fine().x;\n`],
    ["a subclass that calls super() first", `class Base {\n  id = 1;\n}\nclass Late extends Base {\n  extra: number;\n  constructor() {\n    super();\n    this.extra = 2;\n  }\n}\nexport const extra = new Late().extra;\n`],
    ["declared fields beside a computed method name that is a constant", `const name = "describe";\nclass Fiber {\n  declare id: number;\n  constructor() {\n    this.id = 1;\n  }\n  [name]() {\n    return this.id;\n  }\n}\nexport const id = new Fiber().id;\n`],
    ["a class that is never used", `function unused() {\n  class Row {\n    value = 1;\n  }\n  return new Row();\n}\nexport const one = 1;\n`],
  ])("not %s", async (_, source) => {
    expect(await check({ "main.ts": source }, "--aot-deny=lost-layout")).toMatchObject({ findings: [], exitCode: 0 });
  }, 60_000);
});

describe.concurrent("untyped-base", () => {
  const source = `class Failure extends Error {\n  code = 1;\n}\nclass Timeout extends Failure {\n  after = 2;\n}\nexport const codes = [new Failure("a").code, new Timeout("b").after];\n`;

  test("a class that extends a built-in class, and its subclasses", async () => {
    expect(await check({ "main.ts": source }, "--aot-deny=untyped-base")).toMatchObject({
      findings: [
        "deny untyped-base TS100027 main.ts:1:7 Class 'Failure' extends a class from outside typed code, so it has no fixed layout and its instances are compiled as untyped objects.",
        "  main.ts:1:23 This base class is a built-in or comes from JavaScript.",
        "deny untyped-base TS100027 main.ts:4:7 Class 'Timeout' extends a class from outside typed code, so it has no fixed layout and its instances are compiled as untyped objects.",
        "  main.ts:4:23 Its base class 'Failure' has no fixed layout.",
        "  main.ts:1:23 This base class is a built-in or comes from JavaScript.",
      ],
      exitCode: 1,
    });
  }, 60_000);

  test("is not what lost-layout reports", async () => {
    expect(await check({ "main.ts": source }, "--aot-deny=lost-layout")).toMatchObject({ findings: [], exitCode: 0 });
  }, 60_000);
});

describe.concurrent("open-layout", () => {
  test("a type that only typed code creates is not reported", async () => {
    const files = { "main.ts": `interface Size {\n  width: number;\n}\nconst size: Size = { width: 3 };\nexport const width = size.width;\n` };
    expect(await check(files, "--aot-deny=open-layout")).toMatchObject({ findings: [], exitCode: 0 });
  }, 60_000);

  test("a type that is open because another one is names both", async () => {
    const files = {
      "main.ts": `interface Named {\n  name: string;\n}\ninterface Person extends Named {\n  age: number;\n}\nfunction fromAnywhere(value: any): Person {\n  return value;\n}\nconst made: Person = { name: "a", age: 1 };\nfunction nameOf(named: Named) {\n  return named.name;\n}\nexport const names = [nameOf(made), nameOf(fromAnywhere({ name: "b", age: 2 }))];\n`,
    };
    const { findings, exitCode } = await check(files, "--aot-deny=open-layout");
    expect(findings).toContain("deny open-layout TS100022 main.ts:4:11 'Person' can hold objects that typed code did not create, so every property access through it checks the object first.");
    expect(findings).toContain("deny open-layout TS100022 main.ts:1:11 'Named' can hold objects that typed code did not create, so every property access through it checks the object first.");
    expect(exitCode).toBe(1);
  }, 60_000);
});

describe.concurrent("interpreted", () => {
  const evaluates = (what: string, place: string) => `deny interpreted TS100025 main.ts:${place} '${what}' evaluates source text when the program runs. An --aot executable has no JIT, so that code runs in the interpreter.`;

  test("eval, Function and node:vm", async () => {
    const source = `import vm from "node:vm";
import { runInNewContext } from "node:vm";
export const results = [
  new Function("a", "b", "return a + b")(1, 2),
  Function("return 2")(),
  (0, eval)("3"),
  eval("4"),
  globalThis.eval("5"),
  vm.runInThisContext("6"),
  runInNewContext("7"),
  new vm.Script("8").runInThisContext(),
];
`;
    expect(await check({ "main.ts": source }, "--aot-deny=interpreted")).toMatchObject({
      findings: [
        evaluates("Function", "4:7"),
        evaluates("Function", "5:3"),
        evaluates("eval", "6:7"),
        evaluates("eval", "7:3"),
        evaluates("eval", "8:14"),
        evaluates("vm.runInThisContext", "9:6"),
        evaluates("vm.runInNewContext", "10:3"),
        evaluates("vm.Script", "11:10"),
      ],
      exitCode: 1,
    });
  }, 60_000);

  test("names that are bound to something else are not reported", async () => {
    const source = `function Function(text: string) {\n  return () => text.length;\n}\nconst vm = { runInThisContext: (text: string) => text.length };\nexport const results = [Function("return 2")(), vm.runInThisContext("6"), typeof globalThis.eval, [] instanceof globalThis.Function];\n`;
    expect(await check({ "main.ts": source }, "--aot-deny=interpreted")).toMatchObject({ findings: [], exitCode: 0 });
  }, 60_000);

  test("code that the build removes is not reported", async () => {
    const source = `export const result = process.env.NODE_ENV === "development" ? eval("1") : 2;\n`;
    const removed = await build({ "main.ts": source }, "--aot-deny=interpreted", "--define", 'process.env.NODE_ENV="production"');
    expect({ exitCode: removed.exitCode, wroteExecutable: removed.wroteExecutable }).toEqual({ exitCode: 0, wroteExecutable: true });
    expect((await check({ "main.ts": source }, "--aot-deny=interpreted")).exitCode).toBe(1);
  }, 120_000);
});

describe.concurrent("the summary", () => {
  test("a build ends with one line that says how much of the program is typed", async () => {
    const { stdout, exitCode } = await build(openPoint);
    expect(stdout).toMatch(/^aot: 100\.0% of reads typed, 2 of 3 types open, 0 classes without a layout, 0 packages and 0 files untyped \(--aot-warn=all lists them\)$/m);
    expect(exitCode).toBe(0);
  }, 120_000);

  test("so does bun check --aot", async () => {
    const files = { "main.ts": `interface Size {\n  width: number;\n}\nconst size: Size = { width: 3 };\nexport const width = size.width;\n` };
    const { stderr, exitCode } = await check(files);
    expect(stderr).toMatch(/^aot: 100\.0% of reads typed, 0 of 1 type open, 0 classes without a layout, 0 packages and 0 files untyped$/m);
    expect(exitCode).toBe(0);
  }, 60_000);
});
