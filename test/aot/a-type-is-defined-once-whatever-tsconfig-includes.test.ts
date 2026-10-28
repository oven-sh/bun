// A file leaves an object type to a file that was lowered before it. Which files tsconfig.json includes changes the numbers of the files, not that.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

const fileCount = 12;
const fields = Array.from({ length: 60 }, (_, index) => `f${index}`);
const compilerOptions = {
  target: "esnext",
  module: "preserve",
  moduleResolution: "bundler",
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  typeRoots: [join(import.meta.dir, "..", "..", "packages")],
  types: ["bun-types"],
};

function program(): Record<string, string> {
  const files: Record<string, string> = {
    "shapes.ts": `export interface Wide {\n${fields.map(field => `  ${field}: number;\n`).join("")}}\n`,
    "main.ts": `import type { Wide } from "./shapes";\nimport { sum0 } from "./a0";\nconst wide: Wide = { ${fields.map((field, index) => `${field}: ${index}`).join(", ")} };\nconsole.log(sum0(wide));\n`,
  };
  for (let index = 0; index < fileCount; index++) {
    const rest = index + 1 < fileCount ? ` + sum${index + 1}(wide)` : "";
    const next = index + 1 < fileCount ? `import { sum${index + 1} } from "./a${index + 1}";\n` : "";
    files[`a${index}.ts`] =
      `import type { Wide } from "./shapes";\n${next}export function sum${index}(wide: Wide): number {\n  return wide.${fields[index]}${rest};\n}\n`;
  }
  return files;
}

async function build(name: string, tsconfig: object) {
  using dir = tempDir("aot-" + name, { ...program(), "tsconfig.json": JSON.stringify(tsconfig) });
  const folder = String(dir);
  const report = join(folder, "report.json");
  const executable = join(folder, isWindows ? "out.exe" : "out");
  built(
    await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-threads=1",
        "--aot-report=" + report,
        "./main.ts",
        "--outfile",
        executable,
      ],
      folder,
      bunEnv,
    ),
  );
  const { stdout, exitCode } = await spawned([executable], folder, bunEnv);
  return { queries: JSON.parse(readFileSync(report, "utf8")).statistics.CheckerQueries as number, stdout, exitCode };
}

test("files that tsconfig.json includes define a type as often as files that only imports find", async () => {
  const found = await build("files-found-by-imports", { files: [], compilerOptions });
  const included = await build("files-included", { compilerOptions });
  expect(included).toMatchObject({ stdout: found.stdout, exitCode: 0 });
  expect(included.queries - found.queries).toBeLessThan(fields.length);
}, 240_000);
