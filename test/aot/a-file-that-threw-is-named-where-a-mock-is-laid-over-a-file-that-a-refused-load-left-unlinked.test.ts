import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// gate.mjs is refused: ledger.mjs imports a name that nothing exports. tray.mjs stands behind ledger.mjs in gate.mjs, so the refused load leaves it unlinked.
const refused = {
  "gate.mjs": `import { ledger } from "./ledger.mjs";\nimport { tray } from "./tray.mjs";\nexport const gate = [ledger, tray];\n`,
  "ledger.mjs": `import { nothing } from "./columns.mjs";\nexport const ledger = nothing;\n`,
  "columns.mjs": `export * from "./far.mjs";\nexport * from "./legacy.cjs";\n`,
  "far.mjs": `export const far = 1;\n`,
  "legacy.cjs": `exports.old = 1;\n`,
  "tray.mjs": `export const tray = "real";\n`,
};
const thrower = { "thrower.mjs": `export const never = 1;\nthrow new Error("thrown");\n` };
const ask = (file: string) => `  await import("./${file}").catch(() => {});\n`;
const lay = `  await mock.module("./tray.mjs", () => ({ tray: "mock" }));\n`;
const inTest = (body: string) => `import { test, mock } from "bun:test";\ntest("t", async () => {\n${body}});\n`;
const runs = {
  "a file that threw is asked for again behind the mock": {
    files: {
      ...refused,
      ...thrower,
      "a.test.mjs": inTest(ask("thrower.mjs") + ask("gate.mjs") + lay + ask("thrower.mjs")),
    },
    named: ["thrower.mjs, while a.test.mjs ran"],
  },
  "nobody asks for it again": {
    files: { ...refused, ...thrower, "a.test.mjs": inTest(ask("thrower.mjs") + ask("gate.mjs") + lay) },
    named: [],
  },
  "nothing threw": {
    files: { ...refused, "a.test.mjs": inTest(ask("gate.mjs") + lay + ask("gate.mjs")) },
    named: [],
  },
};

test.each(Object.entries(runs))("%s", async (_, { files, named }: { files: object; named: string[] }) => {
  using directory = tempDir("a-file-that-threw-beside-a-refused-load", {
    "package.json": `{ "name": "made-up" }`,
    ...files,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(directory), bunEnv);
  const lines = (stdout + "\n" + stderr).split("\n");
  const rows = lines.filter(line => / ran$/.test(line) && line.includes(", while ")).map(line => line.trim());
  expect(rows.sort()).toEqual(named);
  expect(lines.some(line => line.includes("didn't run again"))).toBe(named.length > 0);
  expect(exitCode).toBe(0);
});
