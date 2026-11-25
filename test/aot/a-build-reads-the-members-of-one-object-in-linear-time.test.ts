// Runs alone: it judges by the processor seconds of builds.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { describe, test } from "./supported";

// A build finds what `require(object.name)` may name. It listed all the members of the object for each read, if one key of it was computed, and again after each store.
const read = (expression: string) => `try { require(${expression}); } catch {}`;
const upTo = (count: number, line: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => line(index));

const shapes: Record<string, (count: number) => string[]> = {
  "written keys": count => [
    "const o = {",
    ...upTo(count, i => `k${i}: "./none${i}",`),
    "};",
    ...upTo(count, i => read(`o.k${i}`)),
  ],
  "written keys and one getter": count => [
    "const o = { get g() { return 1; },",
    ...upTo(count, i => `k${i}: "./none${i}",`),
    "};",
    ...upTo(count, i => read(`o.k${i}`)),
  ],
  "written keys and one computed key": count => [
    'const name = "c" + "d";',
    "const o = { [name]: 1,",
    ...upTo(count, i => `k${i}: "./none${i}",`),
    "};",
    ...upTo(count, i => read(`o.k${i}`)),
  ],
  "computed keys": count => [
    "const o = {",
    ...upTo(count, i => `["k" + ${i}]: "./none${i}",`),
    "};",
    ...upTo(count, i => read(`o.k${i}`)),
  ],
  "stores and reads in turns": count => [
    "const o = {};",
    ...upTo(count, i => `o.k${i} = "./none${i}"; ${read(`o.k${i}`)}`),
  ],
  "one name in many objects": count => [
    ...upTo(count, i => `function f${i}(a) { a.path = "./none${i}"; ${read("a.path")} }`),
    ...upTo(count, i => `f${i}({ path: "./other${i}" });`),
  ],
  "a table of exports": count => [
    "const define = (to, from) => { for (const k in from) Object.defineProperty(to, k, { get: from[k], enumerable: true }); };",
    "const all = {}; define(all, {",
    ...upTo(count, i => `v${i}: () => v${i},`),
    "});",
    ...upTo(count, i => `var v${i} = "./none${i}";`),
    ...upTo(count, i => read(`all.v${i}`)),
  ],
};

async function build(folder: string, lines: string[], count: number) {
  writeFileSync(join(folder, `${count}.cjs`), [...lines, 'console.log("done");', ""].join("\n"));
  await using built = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `./${count}.cjs`,
      "--outfile",
      join(folder, count + (isWindows ? ".exe" : "")),
    ],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90_000,
  });
  const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  return Number(built.resourceUsage()!.cpuTime.user) / 1e6;
}

describe("a build of eight times as many reads of one object", () => {
  test.each(Object.keys(shapes))(
    "%s",
    async name => {
      using dir = tempDir("aot-members-of-one-object", {});
      const few = await build(String(dir), shapes[name](1000), 1000);
      const many = await build(String(dir), shapes[name](8000), 8000);
      reads(name, many / few, 2, "times the processor seconds");
      if (!isASAN && !isDebug) expect(many / few).toBeLessThan(2);
    },
    240_000,
  );
});
