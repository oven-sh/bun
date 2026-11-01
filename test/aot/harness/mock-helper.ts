import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, test } from "../supported";
import { countedMockStates } from "./mock-states";
import { run } from "./run";
import { waysFor } from "./ways";

// A module that is no test file lays a mock in its body, and several test files import it. The mocks of a test file are undone when it ends, so `bun test` runs such a
// module again for the next test file that imports it. A compiled body runs once: the calls that it made are made again, in their order, when the load of the next test
// file comes to the module.
export const head = `import { afterEach, mock, test, vi } from "bun:test";\n`;
export const reads = `const tax = await import("./tax.js"); const cart = await import("./cart.js");`;
export const looks = (name: string) =>
  `${head}test("${name}", async () => { ${reads} console.log("OUT ${name}", tax.rate, "|", cart.price()); });`;
export const withHelper = (name: string) => `import "./helper.js";\n${looks(name)}`;
export const runner = `import { mock, vi } from "bun:test";\n`;
export const lays = (call = "vi.mock", rate = "mock rate") =>
  `${runner}${call}("./tax.js", () => ({ rate: "${rate}" }));\n`;
export const mocked = (name: string, rate = "mock rate") => `OUT ${name} ${rate} | price by ${rate}`;
export const real = (name: string) => mocked(name, "real rate");

export type Project = {
  files: Record<string, string>;
  said: string[];
  // What only a body that runs again can give. It is pinned as it is.
  compiledSays?: string[];
  // It runs in every way. On the build in front of the cure each project that failed over layers failed as one program too, 26 of 26.
  isWitness?: boolean;
};
const filler = Array.from({ length: 6000 }, (_, i) => `export function filler${i}(x) { return x + ${i}; }\n`).join("");

export function judge(projects: Record<string, Project>) {
  describe.each(Object.entries(projects))("%s", (_, { files, said, compiledSays = said, isWitness = false }) => {
    const whole = {
      "package.json": `{ "type": "module" }`,
      "tax.js": `export const rate = "real rate";\nexport const other = "real other";`,
      "cart.js": `import { rate } from "./tax.js";\nexport const price = () => "price by " + rate;`,
      ...files,
    };
    const filled = {
      ...Object.fromEntries(
        Object.entries(whole).map(([path, text]) => [
          path,
          path.endsWith(".test.js") ? `import { filler1 } from "./filler.mjs"; void filler1;\n${text}` : text,
        ]),
      ),
      "filler.mjs": filler,
    };
    const oneRealm = ["--parallel=1", "--no-isolate"];
    const ways: [string, string[], string, RegExp, Record<string, string>, string[]][] = [
      [
        "one program",
        ["--aot"],
        "TestRunLayers:0,TestRunSaysItsForm",
        /^AOT test run \| one program/m,
        whole,
        compiledSays,
      ],
      [
        "two layers",
        ["--aot"],
        "TestRunLayers:2,TestRunSaysItsForm",
        /^AOT test run \| layers 2/m,
        whole,
        compiledSays,
      ],
      ["bun test, one worker", oneRealm, "", /^/, filled, said],
      [
        "the layers that a run takes by itself",
        ["--aot", ...oneRealm, "--aot-memory-limit", "1MB"],
        "TestRunSaysItsForm",
        /^AOT test run \| layers [2-9]/m,
        filled,
        compiledSays,
      ],
    ];

    test.concurrent.each([
      ["bun test", [], "", /^/, whole, said] as (typeof ways)[number],
      ...waysFor(ways, isWitness),
    ])(
      "%s",
      async (_, flags, words, form, project, answer) => {
        using directory = tempDir("aot-mock-helper", project);
        using states = countedMockStates();
        const env = {
          ...bunEnv,
          ...states.env,
          NO_COLOR: "1",
          BUN_DEBUG_TEST_AOT_WORDS: words,
        };
        const { stdout, stderr } = await run([bunExe(), "test", ...flags, "."], String(directory), env);
        expect(stdout + "\n" + stderr).toMatch(form);
        expect((stdout + "\n" + stderr).split("\n").filter(line => /^OUT |^error: /.test(line))).toEqual(answer);
        // ./mock-states.table.txt
        expect(states.stepsThatTableLacks().lacking).toEqual([]);
      },
      180_000,
    );
  });
}
