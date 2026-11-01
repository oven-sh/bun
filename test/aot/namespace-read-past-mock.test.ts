import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// leaf.js declares x, barrel.js hands it on and is loaded, vi.doMock() names barrel.js, and then barrel2.js, which has x from barrel.js, is loaded for the first time: it gets the mock.
// The table of barrel2.js names the variable of leaf.js. The build knew `m` in `const m = await import("./barrel2.js")` for the namespace object of barrel2.js and read `m.x` from that variable,
// unless a mock might stand in place of the file that DECLARES it. One might stand on the way. A read that the run time answers was right: `m[key]`, `Object.values(m)`.
const barrels: Record<string, string> = {
  "from": `export { x, y } from "./leaf.js";`,
  "import-export": `import { x, y } from "./leaf.js"; export { x, y };`,
  "star": `export * from "./leaf.js";`,
  "body": `export { x, y } from "./leaf.js"; globalThis.ranBarrel = (globalThis.ranBarrel ?? 0) + 1;`,
};
const files: Record<string, string> = { "package.json": `{ "name": "namespace-read-past-mock", "type": "module" }` };
for (const [barrel, text] of Object.entries(barrels)) {
  files[`${barrel}/leaf.js`] = `export const x = "real x"; export const y = "real y";`;
  files[`${barrel}/barrel.js`] = text;
  files[`${barrel}/barrel2.js`] = `export { x, y } from "./barrel.js";`;
  files[`${barrel}/barrel3.js`] = `export * from "./barrel2.js";`;
  files[`${barrel}/reader.js`] =
    `import * as late from "./barrel2.js"; export const readLate = () => [late.x, late.y].join(" ");`;
  files[`${barrel}/user.js`] = `import { vi } from "bun:test";
import * as ns from "./barrel.js";
const key = JSON.parse('"x"');
const handed = object => object.y;
export const seen = async () => {
  const said = [ns.x];
  vi.doMock("./barrel.js", () => ({ x: "over x", y: "mock y" }));
  const m = await import("./barrel2.js");
  said.push("written " + m.x, "computed " + m[key], "values " + Object.values(m).join("+"), "destructured " + (({ x }) => x)(m), "handed on " + handed(m));
  const further = await import("./barrel3.js");
  said.push("a barrel further up " + further.x);
  const { readLate } = await import("./reader.js");
  said.push("a reader loaded behind the mock " + readLate());
  const leaf = await import("./leaf.js");
  said.push("the file that declares it " + leaf.x);
  return said.join(" | ");
};
`;
  files[`${barrel}/a.test.js`] = `import { test } from "bun:test";
import { seen } from "./user.js";
test("t", async () => console.log("SEEN ${barrel}", await seen()));
`;
}

test("a name read off the namespace object of a module that was loaded behind a mock on its way", async () => {
  using dir = tempDir("aot-namespace-read-past-mock", files);
  const directory = String(dir);
  const said = async (flags: string[]) => {
    const ran = await run([bunExe(), "test", ...flags, "."], directory, { ...bunEnv, BUN_TMPDIR: directory });
    return {
      // The runner takes the files as their folder lists them.
      lines: ran.stdout
        .split("\n")
        .filter(line => line.startsWith("SEEN"))
        .sort(),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail|error)s?$/.test(line)),
    };
  };
  const plain = await said([]);
  expect(plain.summary).toEqual([" 4 pass", " 0 fail"]);
  expect(plain.lines.find(line => line.startsWith("SEEN body "))).toBe(
    "SEEN body real x | written over x | computed over x | values over x+mock y | destructured over x | handed on mock y | a barrel further up over x | a reader loaded behind the mock over x mock y | the file that declares it real x",
  );
  expect(await said(["--aot"])).toEqual(plain);
}, 240_000);
