import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const options = `"target": "esnext", "module": "esnext", "moduleResolution": "bundler", "skipLibCheck": true, "types": []`;
const project = {
  "sub/tsconfig.json": `{ "compilerOptions": { ${options}, "strict": true } }`,
  "sub/main.ts": `console.log("preloaded:", (globalThis as any).preloaded);`,
  "util/helper.ts": `export const helper = (text: string) => text + "loaded";`,
};

async function run(files: Record<string, string>, args: string[]) {
  using dir = tempDir("aot-preload", { ...project, ...files });
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], join(String(dir), "sub"), {
    ...bunEnv,
    BUN_JSC_crashIfInterpreterIsUsed: "1",
  });
  return { stdout, stderr, exitCode };
}

test.concurrent(
  "a JavaScript preload under no tsconfig.json is compiled",
  async () => {
    const files = { "preload.cjs": `globalThis.preloaded = "by JavaScript";` };
    expect(await run(files, ["run", "--debug-aot", "--preload", "../preload.cjs", "./main.ts"])).toEqual({
      stdout: "preloaded: by JavaScript\n",
      stderr: "",
      exitCode: 0,
    });
  },
  120_000,
);

test.concurrent(
  "a preload under another tsconfig.json that type checks under the entry point's too is compiled",
  async () => {
    const files = {
      "tsconfig.json": `{ "compilerOptions": { ${options}, "strict": false } }`,
      "preload.ts": `import { helper } from "./util/helper";\n(globalThis as any).preloaded = helper("pre");`,
    };
    expect(await run(files, ["run", "--debug-aot", "--preload", "../preload.ts", "./main.ts"])).toEqual({
      stdout: "preloaded: preloaded\n",
      stderr: "",
      exitCode: 0,
    });
  },
  120_000,
);

const rightUnderItsOwnAlone = {
  "tsconfig.json": `{ "compilerOptions": { ${options}, "strict": false, "paths": { "@util/*": ["./util/*"] } } }`,
  "preload.ts": `import { helper } from "@util/helper";\nfunction loose(chunk) { return chunk; }\n(globalThis as any).preloaded = loose(helper("pre"));`,
};

test.concurrent(
  "a preload is checked under its own tsconfig.json",
  async () => {
    expect(await run(rightUnderItsOwnAlone, ["run", "--debug-aot", "--preload", "../preload.ts", "./main.ts"])).toEqual(
      { stdout: "preloaded: preloaded\n", stderr: "", exitCode: 0 },
    );
  },
  120_000,
);

test.concurrent(
  "a preload that needs its own tsconfig.json to leave strictNullChecks off stops the build",
  async () => {
    const files = {
      ...rightUnderItsOwnAlone,
      "preload.ts": rightUnderItsOwnAlone["preload.ts"] + `\nconst nothing: string = null;\nloose(nothing);`,
    };
    const { stdout, stderr, exitCode } = await run(files, [
      "run",
      "--debug-aot",
      "--preload",
      "../preload.ts",
      "./main.ts",
    ]);
    expect(stderr).toContain("error: TS2322: Type 'null' is not assignable to type 'string'.");
    expect(stderr).not.toContain("TS100010");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  },
  120_000,
);

test.concurrent(
  "a type error in a preload under the entry point's own tsconfig.json still stops the build",
  async () => {
    const files = {
      "sub/preload.ts": `function loose(chunk) { return chunk; }\n(globalThis as any).preloaded = loose("own");`,
    };
    const { stdout, stderr, exitCode } = await run(files, [
      "run",
      "--debug-aot",
      "--preload",
      "./preload.ts",
      "./main.ts",
    ]);
    expect(stderr).toContain("error: TS7006: Parameter 'chunk' implicitly has an 'any' type.");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  },
  120_000,
);
