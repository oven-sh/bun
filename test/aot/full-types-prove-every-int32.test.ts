// A program that installs the full types under packages/full-types gets no warning about them. Each text is laid here as a TypeScript file of a package and goes through the checker of a
// build, as packages/full-types/one_name.py sends it before it writes it. A type error in the text would be TS100009. An `int32` that the compiler cannot prove would be TS100066, on every
// build, unless the value that enters it is written `e as int32`.
import { expect, test } from "bun:test";
import { cpSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./run-programs";

const standIns = join(import.meta.dir, "typed-packages", "react-reconciler-host", "stand-ins");
const fullTypes = join(import.meta.dir, "..", "..", "packages", "full-types");

async function check(text: string, name: string) {
  using dir = tempDir("aot-full-types-prove-every-int32", {
    "main.ts": `import * as all from "under-test";\nconsole.log(typeof all);\n`,
    "node_modules/under-test/package.json": JSON.stringify({ name: "under-test", version: "1.0.0", main: name }),
    [`node_modules/under-test/${name}`]: text,
    "node_modules/react-dom/package.json": JSON.stringify({ name: "react-dom", version: "1.0.0", main: "index.js" }),
    "node_modules/react-dom/index.js": `module.exports = {};\n`,
  });
  const folder = String(dir);
  for (const standIn of ["react", "scheduler"])
    cpSync(join(standIns, standIn), join(folder, "node_modules", standIn), { recursive: true });
  const checked = await spawned(
    [bunExe(), "check", "--no-pretty", "--aot", "--define", `process.env.NODE_ENV="production"`, "main.ts"],
    folder,
    bunEnv,
  );
  const said = (checked.stdout + checked.stderr).split("\n");
  return { said: said.filter(line => /\bTS\d+:/.test(line)), exitCode: checked.exitCode };
}

test.skipIf(!!unsupported).each([
  ["react-reconciler/0.33.0", "cjs/react-reconciler.production.js", "text.cts"],
  ["seroval/1.6.9", "dist/index.js", "text.mts"],
  ["react-dom/19.3.0", "cjs/react-dom-server-legacy.browser.production.js", "text.cts"],
  ["react-dom/19.3.0", "cjs/react-dom-server.bun.production.js", "text.cts"],
  ["react-dom/19.3.1", "cjs/react-dom-server-legacy.browser.production.js", "text.cts"],
  ["react-dom/19.3.1", "cjs/react-dom-server.bun.production.js", "text.cts"],
])(
  "a program is told nothing about the full types of %s: %s",
  (version, file, name) =>
    slot(async () => {
      expect(await check(await Bun.file(join(fullTypes, version, "lay", file)).text(), name)).toEqual({
        said: [],
        exitCode: 0,
      });
    }),
  120_000,
);

const declarations = `type int32 = import("bun").int32;\n`;

test.skipIf(!!unsupported)(
  "in a package `e as int32` is the author's word, and a flow without it is reported",
  () =>
    slot(async () => {
      const asserted = `${declarations}export function count(given: number): int32 { return given as int32; }
function random(): number { return Math.random(); }\nexport function inTailPosition(): int32 { return random() as int32; }\n`;
      expect(await check(asserted, "text.mts")).toEqual({ said: [], exitCode: 0 });
      const plain = `${declarations}export function count(given: number): int32 { return given; }\n`;
      expect((await check(plain, "text.mts")).said.join("\n")).toContain("TS100066");
    }),
  120_000,
);
