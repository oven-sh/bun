import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const chain = (length: number) => {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "src/low.js": `globalThis.loads.push("low");\nexport const low = 1000;\n`,
    "a.test.js": `import { test } from "bun:test";
globalThis.loads = [];
test("a", async () => {
  const path = Object.keys(require.cache).find(key => key.endsWith("low.js")) ?? require.resolve("./src/low.js");
  require(path);
  delete require.cache[path];
  const { v0 } = await import("./src/m0.js");
  console.log("SAID", v0, globalThis.loads.join());
});
`,
  };
  for (let index = 0; index < length; index++) {
    const next =
      index + 1 < length
        ? `import { v${index + 1} as next } from "./m${index + 1}.js";`
        : `import { low as next } from "./low.js";`;
    files[`src/side${index}.js`] = `import { back${index} } from "./m${index}.js";
globalThis.loads.push("side${index}");
export const side${index} = () => ${index} + back${index};
`;
    files[`src/m${index}.js`] = `import { side${index} } from "./side${index}.js";
${next}
globalThis.loads.push("m${index}");
export const back${index} = 1;
export const v${index} = side${index}() + next;
`;
  }
  return files;
};

test.concurrent.each([20, 80])(
  "a chain of %d modules, each in a cycle, above a file that was taken out of require.cache",
  async length => {
    using dir = tempDir("aot-modules-above-an-evicted-file", chain(length));
    const cwd = String(dir);
    const said = async (flags: string[]) => {
      const env = {
        ...bunEnv,
        BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0",
        [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
      };
      const { stdout, stderr } = await run([bunExe(), "test", ...flags, "--isolate"], cwd, env);
      return [
        ...stdout.split("\n").filter(line => line.startsWith("SAID")),
        ...(stderr.match(/^ \d+ (pass|fail)$/gm) ?? []),
      ];
    };
    const plain = await said([]);
    expect(plain.slice(1)).toEqual([" 1 pass", " 0 fail"]);
    expect(await said(["--aot"])).toEqual(plain);
    const compared = readdirSync(cwd)
      .filter(name => name.startsWith("counts-"))
      .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
      .filter(line => line.endsWith("\tcounter:FilesComparedWithDisk"))
      .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0);
    expect(compared).toBeWithin(1, 2 * length + 3);
  },
  240_000,
);
