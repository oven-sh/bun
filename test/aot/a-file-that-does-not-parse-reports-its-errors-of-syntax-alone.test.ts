import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, target: "ESNext", module: "Preserve", types: [] } });

async function codesOfRefusedBuild(files: Record<string, string>) {
  using dir = tempDir("errors-of-syntax-alone", { "tsconfig.json": tsconfig, ...files });
  const command = [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "out"];
  const { stderr, exitCode } = await run(command, String(dir), { ...bunEnv, NO_COLOR: "1" });
  expect(exitCode).toBe(1);
  return [...stderr.matchAll(/^error: (TS\d+):/gm)].map(match => match[1]);
}

const nested = (levels: number) =>
  "[1].forEach(x => " + "type T = A extends B ? ".repeat(levels) + "1" + " : C".repeat(levels) + ");\n";

test("what the checker says of a tree that the parser patched up is not reported", async () => {
  for (const levels of [1, 2, 8]) {
    const codes = await codesOfRefusedBuild({ "main.ts": nested(levels) });
    expect({ levels, codes: [...new Set(codes)] }).toEqual({ levels, codes: ["TS1005"] });
  }
});

test("a file that parses reports its errors of meaning, beside a file that does not", async () => {
  expect(await codesOfRefusedBuild({ "main.ts": `const text: number = "a";\nmissing(text);\n` })).toEqual([
    "TS2322",
    "TS2304",
  ]);
  const codes = await codesOfRefusedBuild({
    "main.ts": `import "./broken";\nconst text: number = "a";\nexport {};\n`,
    "broken.ts": nested(1) + "export {};\n",
  });
  expect([...new Set(codes)].sort()).toEqual(["TS1005", "TS2322"]);
});
