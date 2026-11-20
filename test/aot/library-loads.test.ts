import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "./with-compiler";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
    skipLibCheck: true,
  },
});

const bells = {
  "package.json": JSON.stringify({ name: "bells", version: "1.0.0", type: "module", main: "./index.js" }),
  "index.js": `globalThis.rung = (globalThis.rung ?? 0) + 1;\nexport const bell = 1;\nexport default 2;\n`,
  "index.d.ts": `export declare const bell: number;\ndeclare const other: number;\nexport default other;\n`,
};

const files = {
  "library/tsconfig.json": tsconfig,
  "library/package.json": JSON.stringify({ name: "chimes", version: "1.2.3", dependencies: { bells: "1.0.0" } }),
  "library/node_modules/bells": bells,
  "library/src/ring.d.ts": `export declare function ring(): string;\n`,
  "library/src/index.ts": `import { ring } from "./ring.js";
export function rings(): string {
  return ring();
}
`,
  "app/tsconfig.json": tsconfig,
  "app/package.json": JSON.stringify({ name: "app", dependencies: { chimes: "1.2.3", bells: "1.0.0" } }),
  "app/node_modules/bells": bells,
  "app/app.ts": `import { rings } from "chimes";
console.log(rings());
`,
};

const env = { ...bunEnv, NO_COLOR: "1" };

async function spawned(cwd: string, ...cmd: string[]) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("a library loads what its JavaScript loads", () => {
  test.each([
    ["a name that nothing reads", `import { bell } from "bells";`, "String(globalThis.rung)"],
    ["a default that nothing reads", `import bell from "bells";`, "String(globalThis.rung)"],
    ["a namespace that nothing reads", `import * as bell from "bells";`, "String(globalThis.rung)"],
    ["a name that a parameter hides", `import { bell } from "bells";`, "(bell => bell + globalThis.rung)(``)"],
    ["a name that it reads", `import { bell } from "bells";`, "String(globalThis.rung * bell)"],
    ["no name", `import "bells";`, "String(globalThis.rung)"],
  ])("%s", async (_, statement, expression) => {
    using dir = tempDir("aot-library-loads", {
      ...files,
      "library/src/ring.js": `${statement}\nexport function ring() {\n  return ${expression};\n}\n`,
    });
    const [library, app] = [join(String(dir), "library"), join(String(dir), "app")];
    expect(await spawned(library, bunExe(), "compile", "--library", "src/index.ts")).toMatchObject({
      stderr: "",
      exitCode: 0,
    });
    expect(existsSync(join(library, "dist/index.aot.ts"))).toBe(true);
    cpSync(join(library, "dist"), join(app, "node_modules/chimes"), { recursive: true });
    const said = { stdout: "1\n", stderr: "", exitCode: 0 };
    expect(await spawned(app, bunExe(), "app.ts")).toEqual(said);
    expect(await spawned(app, bunExe(), "run", "--aot", "app.ts")).toEqual(said);
    expect(await spawned(app, bunExe(), "compile", "./app.ts")).toMatchObject({ exitCode: 0 });
    expect(await spawned(app, join(app, isWindows ? "app.exe" : "app"))).toEqual(said);
  });
});
