import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const modules = Object.fromEntries(
  ["a", "b", "c"].map(name => [`${name}.mjs`, `export const x = "x of ${name}";\nexport let y = "y of ${name}";\n`]),
);
const readAll = (require: string) => `function readX(ns) { return ns.x; }
function readY(ns) { return ns.y; }
const readAll = () => {
  const A = ${require}("./a.mjs"), B = ${require}("./b.mjs"), C = ${require}("./c.mjs");
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add([readX(A), readX(B), readX(C), readY(A), readY(B), readY(C)].join(", "));
  return [...seen].join(" || ");
};
`;
const readByName = `import { x, y } from "./a.mjs";
const byName = () => x + ", " + y;
let last;
for (let i = 0; i < 200; i++) last = byName();
console.log("seen: by name", last);
`;
const otherFile = `import { test } from "bun:test";
import { x } from "./b.mjs";
import { y } from "./c.mjs";
test("other", () => void [x, y]);
`;

const projects: Record<string, Record<string, string>> = {
  "the test file reads": {
    "main.test.mjs": `import { test } from "bun:test";
${readByName}${readAll("import.meta.require")}console.log("seen: off the objects", readAll());
test("end", () => {});
`,
  },
  "a file that the test file imports reads": {
    "low.cjs": `${readAll("require")}exports.readAll = readAll;\n`,
    "main.test.mjs": `import { test } from "bun:test";
import low from "./low.cjs";
${readByName}console.log("seen: off the objects", low.readAll());
test("end", () => {});
`,
  },
};

test.each(Object.keys(projects))(
  "%s",
  async name => {
    using dir = tempDir("aot-namespace-own-structure", {
      "package.json": `{}`,
      ...modules,
      "z.test.mjs": otherFile,
      ...projects[name],
    });
    const seenWith = async (words: string, ...flags: string[]) => {
      const { stdout, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_DEBUG_TEST_AOT_WORDS: words,
      });
      return { lines: stdout.split("\n").filter(line => line.startsWith("seen: ")), exitCode };
    };
    const [plain, oneProgram, twoLayers, threeLayers] = await Promise.all([
      seenWith("TestRunLayers:0"),
      seenWith("TestRunLayers:0", "--aot"),
      seenWith("TestRunLayers:2", "--aot"),
      seenWith("TestRunLayers:3", "--aot"),
    ]);
    expect(plain).toEqual({
      lines: ["seen: by name x of a, y of a", "seen: off the objects x of a, x of b, x of c, y of a, y of b, y of c"],
      exitCode: 0,
    });
    expect(oneProgram).toEqual(plain);
    expect(twoLayers).toEqual(plain);
    expect(threeLayers).toEqual(plain);
  },
  180_000,
);
