// src/sema/program/code_barrels/object_reads.rs answers, on the tree of the ahead-of-time compiler, what the bundler's parser answers on its
// own: which names does a file read from the object of a module that `import()` or `require()` evaluates to? Three tests of
// src/aot/compile/barrel_tests.rs list entry points by what is loaded behind a barrel. This test holds the same lines against the bundler:
// a file behind the barrel is in the output or it is not.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const tests = readFileSync(join(import.meta.dir, "../../src/aot/compile/barrel_tests.rs"), "utf8");

function entryPointsOf(name: string): string[] {
  const start = tests.indexOf(`fn ${name}() {`);
  expect(start).toBeGreaterThan(0);
  const list = tests.slice(start, tests.indexOf("];", start));
  const lines = list.split("\n").filter(line => line.trimStart().startsWith('"'));
  return lines.map(line => JSON.parse(line.trim().replace(/,$/, "")));
}

const kept: [string, string][] = [
  ["names_read_through_callbacks_patterns_and_bindings_are_the_names_of_a_call", "b"],
  ["call_whose_object_nothing_looks_at_loads_the_barrel_alone", ""],
  ["object_of_a_call_that_goes_out_of_sight_loads_everything", "abc"],
];

for (const [name, expected] of kept) {
  test(name, async () => {
    const entryPoints = entryPointsOf(name);
    expect(entryPoints.length).toBeGreaterThan(10);
    const files: Record<string, string> = {
      "node_modules/lib/package.json": `{ "name": "lib", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }`,
      "node_modules/lib/index.js": `export { a } from "./a.js"; export { b } from "./b.js"; export { c } from "./c.js";`,
    };
    for (const letter of "abc")
      files[`node_modules/lib/${letter}.js`] =
        `console.log("MARK-${letter}"); export const ${letter} = 1; export default "${letter}";`;
    entryPoints.forEach((entryPoint, index) => (files[`main${index}.ts`] = entryPoint));
    using directory = tempDir("names-read-from-a-loaded-barrel", files);
    const found: Record<string, string> = {};
    for (const [index, entryPoint] of entryPoints.entries()) {
      const built = await Bun.build({ entrypoints: [join(String(directory), `main${index}.ts`)], target: "bun" });
      const text = (await Promise.all(built.outputs.map(output => output.text()))).join("\n");
      found[entryPoint] = [..."abc"].filter(letter => text.includes(`MARK-${letter}`)).join("");
    }
    expect(found).toEqual(Object.fromEntries(entryPoints.map(entryPoint => [entryPoint, expected])));
  });
}
