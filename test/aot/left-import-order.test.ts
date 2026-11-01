// Where some code of the program may take a file out of require.cache, or stores into require.extensions, the loader of the run time links the import statements
// of a test file. A CommonJS file that an ES module imports further down still runs while the graph is loaded, ahead of every ES body, as in `bun test`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const triggers = {
  "delete require.cache[key]": `exports.get = key => { delete require.cache[key]; };`,
  "require.extensions[ext] = handler": `exports.set = (ext, handler) => { require.extensions[ext] = handler; };`,
  "nothing": `exports.get = key => key;`,
};
const chain = (names: string[]) =>
  Object.fromEntries(
    names.map((name, index) => [
      `${name}.mjs`,
      index === 0
        ? `import c from "q"; console.log("OUT ${name}"); export const ${name} = c;`
        : `import { ${names[index - 1]} } from "./${names[index - 1]}.mjs"; console.log("OUT ${name}"); export const ${name} = ${names[index - 1]};`,
    ]),
  );
const depths = { "one file": ["one"], "two files": ["one", "two"], "three files": ["one", "two", "three"] };

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

const cases = Object.keys(triggers).flatMap(trigger => Object.keys(depths).map(depth => [trigger, depth] as const));

test.concurrent.each(cases)(
  "%s in the program, %s between",
  async (trigger, depth) => {
    const names = depths[depth as keyof typeof depths];
    const top = names.at(-1)!;
    using folder = tempDir("aot-left-import-order", {
      "package.json": `{ "name": "left-import-order", "type": "module" }`,
      "node_modules/q/package.json": `{ "name": "q", "main": "c.js" }`,
      "node_modules/q/c.js": `console.log("OUT c");\n${triggers[trigger as keyof typeof triggers]}`,
      "e.mjs": `console.log("OUT e"); export const e = 1;`,
      ...chain(names),
      "t.test.mjs": `import { test } from "bun:test";
import { e } from "./e.mjs";
import { ${top} } from "./${top}.mjs";
test("t", () => console.log("OUT t", e, typeof ${top}));`,
    });
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain).toEqual({
      lines: ["OUT c", "OUT e", ...names.map(name => "OUT " + name), "OUT t 1 object"],
      exitCode: 0,
    });
    expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await run(dir, ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  240_000,
);
