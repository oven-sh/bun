import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Under `bun test`, `import.meta.env` is an object of its own: a view of `process.env` with Vite's variables, of which DEV, PROD and SSR are booleans.
// Everywhere else it is `process.env`, which holds nothing but strings. Compiled code that took a boolean for a string went the wrong way at
// `import.meta.env.DEV ? .. : ..`, and read memory at the address 7 where it asked for the length.

const reads = [
  `import.meta.env.DEV ? "dev" : "not dev"`,
  `import.meta.env.PROD ? "prod" : "not prod"`,
  `import.meta.env.SSR ? "ssr" : "not ssr"`,
  `import.meta.env.DEV && "x"`,
  `import.meta.env.PROD || "y"`,
  `import.meta.env.DEV?.length`,
  `JSON.stringify([import.meta.env.BASE_URL, import.meta.env.MODE, import.meta.env.DEV, import.meta.env.PROD, import.meta.env.SSR])`,
  `typeof import.meta.env.DEV + typeof import.meta.env.MODE + typeof import.meta.env.GIVEN + typeof import.meta.env.NOT_GIVEN`,
  `import.meta.env.GIVEN.length + import.meta.env.MODE.length`,
  `import.meta.env === process.env`,
  `Object.keys(import.meta.env).filter(key => /^(BASE_URL|MODE|DEV|PROD|SSR|GIVEN)$/.test(key)).join()`,
  `(name => import.meta.env[name] ? "dev" : "not dev")("DEV")`,
  `(({ DEV, PROD }) => [DEV ? 1 : 2, PROD ? 1 : 2].join())(import.meta.env)`,
];
const file = (extension: string) => `import { test } from "bun:test";
import { isDevelopment } from "./imported.${extension}";
test("reads", () => {
${reads.map((read, index) => `  console.log("ROW ${index}", ${read});`).join("\n")}
  console.log("ROW imported", isDevelopment());
});
`;

test.each(["ts", "js"])(
  "a test file .%s reads the booleans of import.meta.env as bun test does",
  async extension => {
    using dir = tempDir("aot-import-meta-env", {
      "package.json": `{ "name": "import-meta-env", "type": "module" }`,
      [`a.test.${extension}`]: file(extension),
      [`imported.${extension}`]: `export const isDevelopment = () => (import.meta.env.DEV ? "dev" : "not dev");\n`,
    });
    const rowsOf = async (flags: string[], words = "") => {
      const env = { ...bunEnv, NO_COLOR: "1", NODE_ENV: undefined, GIVEN: "abc", BUN_DEBUG_TEST_AOT_WORDS: words };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      return {
        rows: stdout.split("\n").filter(line => line.startsWith("ROW ")),
        exitCode,
        stderr: exitCode ? stderr : "",
      };
    };
    const plain = await rowsOf([]);
    expect(plain.rows.slice(0, 4)).toEqual(["ROW 0 dev", "ROW 1 not prod", "ROW 2 ssr", "ROW 3 x"]);
    expect(plain.rows.length).toBe(reads.length + 1);
    expect(await rowsOf(["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await rowsOf(["--aot", "--isolate"], "TestRunLayers:0")).toEqual(plain);
    expect(await rowsOf(["--aot", "--parallel=2"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  240_000,
);
