import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported";

// `.indexOf`, `.slice` and `.length` fit a string and an Array alike, so the code alone does not say what `text` is. The declaration file does.
// `cut` is not exported and only ever called by its name: it is given what `count` is given.
const code = `export function count(text, mark) {
  let found = 0;
  for (let at = text.indexOf(mark); at !== -1; at = text.indexOf(mark, at + 1)) found += cut(text, at).length;
  return found + text.length;
}
function cut(whole, end) {
  return whole.slice(0, end);
}
`;
const declaration = `export declare function count(text: string, mark: string): number;\n`;

const main = `import { count } from "texts";
const rounds = Number(process.argv[2]);
// Nothing in the program says what these are.
const texts = JSON.parse(process.argv[3]);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += count(texts[i & 3], ",");
console.log(sum > 0);
`;

const layouts: Record<string, Record<string, string>> = {
  "beside the code": {
    "node_modules/texts/package.json": JSON.stringify({
      name: "texts",
      version: "1.0.0",
      type: "module",
      main: "index.js",
      types: "index.d.ts",
    }),
    "node_modules/texts/index.js": code,
    "node_modules/texts/index.d.ts": declaration,
  },
  "beside a file that no declaration imports": {
    "node_modules/texts/package.json": JSON.stringify({
      name: "texts",
      version: "1.0.0",
      type: "module",
      main: "index.js",
    }),
    "node_modules/texts/index.js": `export * from "./inner.js";\n`,
    "node_modules/texts/inner.js": code,
    "node_modules/texts/inner.d.ts": declaration,
  },
  "in the package's folder of declarations": {
    "node_modules/texts/package.json": JSON.stringify({
      name: "texts",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./dist/types/index.d.ts", import: "./dist/index.js" } },
    }),
    "node_modules/texts/dist/index.js": `export * from "./deep/inner.js";\n`,
    "node_modules/texts/dist/deep/inner.js": code,
    "node_modules/texts/dist/types/index.d.ts": `export {};\n`,
    "node_modules/texts/dist/types/deep/inner.d.ts": declaration,
  },
  "beside a module with the extension of one": {
    "node_modules/texts/package.json": JSON.stringify({
      name: "texts",
      version: "1.0.0",
      exports: { ".": { types: "./index.d.ts", import: "./index.mjs" } },
    }),
    "node_modules/texts/index.mjs": code,
    "node_modules/texts/index.d.ts": declaration,
  },
};

async function byNameEachRound(folder: string) {
  const executable = join(folder, isWindows ? "main.exe" : "main");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-count-arrivals", "./main.mjs", "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const counted = async (rounds: number) => {
    const path = join(folder, `counts-${rounds}`);
    const ran = await spawned([executable, String(rounds), `["a,b,c", "no mark", ",,", "d,"]`], folder, {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      BUN_JSC_aotCountsPath: path,
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
    let byName = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, what] = line.split("\t");
      if (what?.startsWith("arrival:")) byName += Number(count);
    }
    return byName;
  };
  return Math.round(((await counted(4500)) - (await counted(500))) / 4000);
}

describe.concurrent("what a package declares of its functions is what their code expects", () => {
  for (const [where, files] of Object.entries(layouts)) {
    test(
      where,
      async () => {
        using dir = tempDir("aot-declarations-of-a-package", { "main.mjs": main, ...files });
        expect(await byNameEachRound(String(dir))).toBe(0);
      },
      300_000,
    );
  }
});
