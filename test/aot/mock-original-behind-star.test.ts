import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `export * from "./barrel.js"`, and a mock of the barrel whose factory takes the original: the names of the mock come through the star, for a written read, for a computed one and for whoever lists the keys.
const over = `vi.mock("./barrel.js", async original => ({ ...(await original()), x: "over x" }));`;
const adds = `vi.mock("./barrel.js", async original => ({ ...(await original()), x: "over x", added: "added" }));`;
const lacks = `vi.mock("./barrel.js", async original => { const { y, ...rest } = await original(); return { ...rest, x: "over x" }; });`;
const withoutOriginal = `vi.mock("./barrel.js", async () => { await 0; return { x: "over x", y: "mock y" }; });`;
const leaf = `export const x = "real x"; export const y = "real y";`;
const star = `export * from "./barrel.js";`;
const throughSecond = `import * as ns from "./barrel2.js";`;
type Project = { mock: string; user: string; barrel2: string; barrel: string; leaf: string };
const projects: Record<string, Project> = {
  "the barrel imports and exports": {
    mock: over,
    user: throughSecond,
    barrel2: star,
    barrel: `import { x, y } from "./leaf.js"; export { x, y };`,
    leaf,
  },
  "the barrel exports from": {
    mock: over,
    user: throughSecond,
    barrel2: star,
    barrel: `export { x, y } from "./leaf.js";`,
    leaf,
  },
  "the barrel has a star itself": {
    mock: over,
    user: throughSecond,
    barrel2: star,
    barrel: `export * from "./leaf.js";`,
    leaf,
  },
  "the barrel declares": { mock: over, user: throughSecond, barrel2: star, barrel: leaf, leaf: "" },
  "the leaf imports the barrel back": {
    mock: over,
    user: throughSecond,
    barrel2: star,
    barrel: `import { x, y } from "./leaf.js"; export { x, y };`,
    leaf: `import * as back from "./barrel.js"; export const saw = () => Object.keys(back); ${leaf}`,
  },
  "a star and a name of its own": {
    mock: over,
    user: throughSecond,
    barrel2: `${star} export const own = "own";`,
    barrel: `export { x, y } from "./leaf.js";`,
    leaf,
  },
  "the mock adds a name": {
    mock: adds,
    user: throughSecond,
    barrel2: star,
    barrel: `export { x, y } from "./leaf.js";`,
    leaf,
  },
  "the mock lacks a name": {
    mock: lacks,
    user: throughSecond,
    barrel2: star,
    barrel: `export { x, y } from "./leaf.js";`,
    leaf,
  },
  "a factory without the original": {
    mock: withoutOriginal,
    user: throughSecond,
    barrel2: star,
    barrel: `export { x, y } from "./leaf.js";`,
    leaf,
  },
  "the mocked barrel itself": {
    mock: over,
    user: `import * as ns from "./barrel.js";`,
    barrel2: star,
    barrel: `export { x, y } from "./leaf.js";`,
    leaf,
  },
};

test.each(Object.keys(projects))(
  "%s: as plain Bun, as one program and in two layers",
  async name => {
    const project = projects[name];
    using dir = tempDir("aot-mock-original-behind-star", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "leaf.js": project.leaf,
      "barrel.js": project.barrel,
      "barrel2.js": project.barrel2,
      "user.js": `${project.user}
const computed = key => { try { return String(ns[key]); } catch (e) { return e.name; } };
const all = () => [ns.x, ns.y, ...JSON.parse('["x","y","added","own"]').map(computed), Object.keys(ns).sort().join("+")].join(" ");
console.log("SEEN at the load", all());
export const seen = all;`,
      "a.test.js": `import { test, vi } from "bun:test";
${project.mock}
import { seen } from "./user.js";
test("t", () => console.log("SEEN in the test", seen()));`,
    });
    const seen = async (flags: string[], words: string) => {
      const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
      const lines = (stdout + "\n" + stderr).split("\n");
      return lines.filter(line => line.startsWith("SEEN") || /^warn: TS\d+/.test(line) || /^(\w*Error): /.test(line));
    };
    const plain = await seen([], "");
    expect(plain.length).toBeGreaterThan(0);
    expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await seen(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  600000,
);
