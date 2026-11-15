import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A preload stores an extension loader, so the statements of the preload and of the test files are left to the loader as names. What stands behind the names is compiled and is loaded as one graph:
// the loader walks no module of it.
const say = (what: string) => `(globalThis.said ??= []).push(${what});\n`;

function project(modules: number, queuesJob: boolean) {
  const named = Array.from({ length: 8 }, (_, part) => Math.floor((part * modules) / 8));
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "bunfig.toml": `[test]\npreload = ["./preload.mjs"]\n`,
    "first.cjs": `${queuesJob ? `Promise.resolve().then(() => { ${say(`"job"`)} });\n` : ""}${say(`"first"`)}exports.value = 1;\n`,
    "preload.mjs": [
      `import Module from "node:module";\n`,
      ...named.map(index => `import * as named${index} from "./m${index}.mjs";\n`),
      `Module._extensions[".unseen"] = () => {};\n`,
      ...named.map(index => say(`Object.keys(named${index}).join()`)),
    ].join(""),
  };
  for (let index = 0; index < modules; index++) {
    files[`leaf${index}.cjs`] =
      `exports.index = ${index};\n` +
      (index ? `exports.before = require(process.env.MADE_UP_NONE || "./leaf${index - 1}.cjs").index;\n` : "");
    files[`m${index}.mjs`] =
      `import { value as next } from "./m${(index + 1) % modules}.mjs";\n` +
      `import leaf from "./leaf${index}.cjs";\n` +
      (index ? "" : `import first from "./first.cjs";\n`) +
      say(index ? `${index}` : `"first is " + first.value`) +
      `export const value = leaf.index;\nexport const ofNext = () => next;\n`;
  }
  for (const name of ["a", "b"])
    files[`${name}.test.mjs`] =
      `import { test } from "bun:test";\n` +
      `import * as m1 from "./m1.mjs";\n` +
      `import { value, ofNext } from "./m2.mjs";\n` +
      `test("${name}", () => console.log("SAID ${name}", globalThis.said.join(" "), m1.value, value, ofNext()));\n`;
  return files;
}

async function outcomeOf(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-names-left-to-the-loader", files);
  const counts = join(String(dir), "counts.txt");
  const env = { ...bunEnv, NO_COLOR: "1", ...(flags.length ? { BUN_JSC_aotCountsPath: counts } : {}) };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const text = flags.length ? readFileSync(counts, "utf8") : "";
  return {
    said: {
      lines: stdout.split("\n").filter(line => line.startsWith("SAID ")),
      ends: stderr
        .split("\n")
        .filter(line => /^\((pass|fail)\) /.test(line))
        .map(line => line.replace(/ \[.*$/, "")),
      exitCode,
    },
    walked: Number(
      text
        .split("\n")
        .find(line => line.endsWith(":CompiledModulesWalkedByLoader"))
        ?.split("\t")[0] ?? -1,
    ),
  };
}

test.each([true, false])("as plain, and no module is walked (a file queues a job: %p)", async queuesJob => {
  const files = project(40, queuesJob);
  const [plain, compiled] = await Promise.all([outcomeOf(files), outcomeOf(files, "--aot")]);
  expect(plain.said.ends).toEqual(["(pass) a", "(pass) b"]);
  expect(compiled.said).toEqual(plain.said);
  expect(compiled.walked).toBe(0);
});
