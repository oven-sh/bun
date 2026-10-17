import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { test } from "./supported";

test("the typed version of a package defines its fields, as the JavaScript it stands for does", async () => {
  const javascript = `class Base { set z(v) { this.seen = v; } }\nexport class A extends Base { x; y = 1; }\nexport class B extends Base { z = 2; }\nexport function keys() { return Object.keys(new A()).join(",") + " " + Object.keys(new B()).join(","); }\n`;
  using dir = tempDir("aot-fields-of-a-typed-version", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        useDefineForClassFields: false,
        strict: true,
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        types: [],
      },
    }),
    "main.ts": `declare const console: { log(...values: unknown[]): void };\nimport { keys } from "fields";\nconsole.log(keys());\n`,
    "node_modules/fields/package.json": JSON.stringify({
      name: "fields",
      version: "1.0.0",
      type: "module",
      main: "index.js",
      types: "index.d.ts",
    }),
    "node_modules/fields/index.js": javascript,
    "node_modules/fields/index.d.ts": `export declare function keys(): string;\n`,
    ".sound/fields/sound.json": JSON.stringify({
      sound: 1,
      name: "fields",
      version: "1.0.0",
      when: {},
      basis: {},
      lay: { "index.js": createHash("sha256").update(javascript).digest("hex"), "index.sound.ts": "new" },
      needs: [],
    }),
    ".sound/fields/lay/index.js": `export * from "./index.sound.ts";\n`,
    ".sound/fields/lay/index.sound.ts": `class Base { declare seen: number | undefined; set z(v: number) { this.seen = v; } }\nexport class A extends Base { x: number | undefined; y: number = 1; }\nexport class B extends Base { // @ts-expect-error\n  z: number = 2; }\nexport function keys(): string { return Object.keys(new A()).join(",") + " " + Object.keys(new B()).join(","); }\n`,
  });
  const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [printed, errors, built] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect({ errors: built ? errors : "", built }).toEqual({ errors: "", built: 0 });
  expect(printed + errors).toContain("typed version");
  await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "x,y z\n", exitCode: 0 });
}, 120_000);

test("a dependency without a tsconfig.json makes its fields as the application's says, as without --aot", async () => {
  using dir = tempDir("aot-fields-of-a-dependency", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { useDefineForClassFields: false, strict: true, typeRoots: ["./no-types-here"] },
    }),
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      version: "1.0.0",
      main: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": `export class Held { late: string | undefined; first = 1; }\n`,
    "node_modules/ships-declarations-too/package.json": JSON.stringify({
      name: "ships-declarations-too",
      version: "1.0.0",
      main: "index.ts",
      types: "index.d.ts",
    }),
    "node_modules/ships-declarations-too/index.ts": `export class Kept { late: string | undefined; first = 1; }\n`,
    "node_modules/ships-declarations-too/index.d.ts": `export declare class Kept { late: string | undefined; first: number; }\n`,
    "main.ts": `
      import { Held } from "ships-typescript";
      import { Kept } from "ships-declarations-too";
      class Own { late: string | undefined; first = 1; }
      console.log(Object.keys(new Own()).join(), Object.keys(new Held()).join(), Object.keys(new Kept()).join());
    `,
  });
  const answers = [];
  for (const flags of [[], ["--aot"]]) {
    const outfile = join(String(dir), "out" + flags.length + (isWindows ? ".exe" : ""));
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", ...flags, "./main.ts", "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [said, built] = await Promise.all([build.stderr.text(), build.exited]);
    expect({ said: built ? said : "", built }).toEqual({ said: "", built: 0 });
    await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
    answers.push({ stdout, exitCode });
  }
  expect(answers).toEqual([
    { stdout: "first first first\n", exitCode: 0 },
    { stdout: "first first first\n", exitCode: 0 },
  ]);
}, 120_000);
