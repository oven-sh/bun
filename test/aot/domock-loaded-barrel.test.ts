import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// vi.doMock() leaves alone what a test file has loaded: whoever is linked keeps the original, and the next import() gets the mock.
// A module that only hands names on has nothing to run, so no status says that it has run. It was taken for one that has yet to load, and the mock was laid over the names
// at once: over the variables of the file that declares them, for everybody, `import("./leaf.js")` too.
const barrels: Record<string, string> = {
  "from": `export { x, y } from "./leaf.js";`,
  "import-export": `import { x, y } from "./leaf.js"; export { x, y };`,
  "star": `export * from "./leaf.js";`,
  "body": `export { x, y } from "./leaf.js"; globalThis.ranBarrel = (globalThis.ranBarrel ?? 0) + 1;`,
};
const users: Record<string, string> = {
  "namespace": `import * as ns from "./barrel2.js"; const key = JSON.parse('"x"'); const read = () => [ns.x, ns[key]].join(" ");`,
  "name": `import { x, y } from "./barrel2.js"; const read = () => [x, y].join(" ");`,
};
const files: Record<string, string> = { "package.json": `{ "name": "domock-loaded-barrel", "type": "module" }` };
for (const [barrel, text] of Object.entries(barrels)) {
  for (const [user, head] of Object.entries(users)) {
    const folder = `${barrel}-${user}`;
    files[`${folder}/leaf.js`] = `export const x = "real x"; export const y = "real y";`;
    files[`${folder}/barrel.js`] = text;
    files[`${folder}/barrel2.js`] = `export { x, y } from "./barrel.js";`;
    files[`${folder}/user.js`] = `import { vi } from "bun:test";
${head}
const ask = async name => { try { const m = await import(name); return [m.x, m.y, Object.keys(m).sort().join("+")].join(" "); } catch (e) { return "threw " + e.name; } };
export const seen = async () => {
  const said = [read()];
  vi.doMock("./barrel.js", () => ({ x: "over x", y: "mock y" }));
  said.push(read(), await ask("./barrel2.js"), await ask("./barrel.js"), await ask("./leaf.js"), read());
  vi.doUnmock("./barrel.js");
  said.push(read(), await ask("./barrel.js"), await ask("./barrel2.js"));
  return said.join(" | ");
};
export const later = () => read();
`;
    files[`${folder}/a.test.js`] = `import { test } from "bun:test";
import { seen } from "./user.js";
test("t", async () => console.log("SEEN ${folder}", await seen()));
`;
    files[`${folder}/b.test.js`] = `import { test } from "bun:test";
import { later } from "./user.js";
test("the next file", async () => { const m = await import("./barrel.js"); console.log("SEEN ${folder} next", later(), m.x, m.y); });
`;
  }
}

test("whoever is linked past a barrel keeps the original behind vi.doMock() of the barrel", async () => {
  using dir = tempDir("aot-domock-loaded-barrel", files);
  const directory = String(dir);
  // What an earlier test file has loaded vi.doMock() does not leave alone, so the order says what is right. The runner takes a folder as it is listed.
  const inOrder = Object.keys(files)
    .filter(file => file.endsWith(".test.js"))
    .sort()
    .map(file => "./" + file);
  const said = async (flags: string[]) => {
    const ran = await run([bunExe(), "test", ...flags, ...inOrder], directory, { ...bunEnv, BUN_TMPDIR: directory });
    return {
      lines: ran.stdout
        .split("\n")
        .filter(line => line.startsWith("SEEN"))
        .sort(),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail|error)s?$/.test(line)),
    };
  };
  for (const isolation of ["--isolate", "--no-isolate"]) {
    const plain = await said([isolation]);
    expect(plain.summary).toEqual([" 16 pass", " 0 fail"]);
    expect(plain.lines.length).toBe(16);
    expect(plain.lines.find(line => line.startsWith("SEEN body-name real"))).toBe(
      "SEEN body-name real x real y | real x real y | real x real y x+y | over x mock y x+y | real x real y x+y | real x real y | real x real y | real x real y x+y | real x real y x+y",
    );
    expect(await said(["--aot", isolation])).toEqual(plain);
  }
}, 240_000);
