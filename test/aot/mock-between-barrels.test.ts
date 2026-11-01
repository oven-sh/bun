import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

// leaf.js declares, barrel.js hands on, barrel2.js hands on again by name, and a mock stands in place of barrel.js, in the middle: whoever asks barrel2.js gets what the mock has.
const plainFactory = `vi.mock("./barrel.js", () => ({ x: "over x", y: "mock y" }));`;
const takesOriginal = `vi.mock("./barrel.js", async original => ({ ...(await original()), x: "over x" }));`;
const leaf = `export const x = "real x"; export const y = "real y";`;
const exportsFrom = `export { x, y } from "./leaf.js";`;
const importsAndExports = `import { x, y } from "./leaf.js"; export { x, y };`;
const secondByName = `export { x, y } from "./barrel.js";`;
const byNamespace = `import * as ns from "./barrel2.js";
const key = JSON.parse('"x"');
export const seen = () => [ns.x, ns[key], ns.y, Object.keys(ns).sort().join("+")].join(" ");`;
const byName = `import { x, y } from "./barrel2.js";
export const seen = () => [x, y].join(" ");`;
type Project = { mock: string; user: string; barrel2: string; barrel: string; leaf?: string };
const projects: Record<string, Project> = {
  "imported by name": { mock: plainFactory, user: byName, barrel2: secondByName, barrel: exportsFrom },
  "imported by name, the barrel imports and exports": {
    mock: plainFactory,
    user: byName,
    barrel2: secondByName,
    barrel: importsAndExports,
  },
  "imported by name, the second barrel imports and exports": {
    mock: plainFactory,
    user: byName,
    barrel2: `import { x, y } from "./barrel.js"; export { x, y };`,
    barrel: exportsFrom,
  },
  "imported by name, the original": { mock: takesOriginal, user: byName, barrel2: secondByName, barrel: exportsFrom },
  "a namespace": { mock: plainFactory, user: byNamespace, barrel2: secondByName, barrel: exportsFrom },
  "a namespace, the barrel imports and exports": {
    mock: plainFactory,
    user: byNamespace,
    barrel2: secondByName,
    barrel: importsAndExports,
  },
  "a namespace, the original": { mock: takesOriginal, user: byNamespace, barrel2: secondByName, barrel: exportsFrom },
  "a namespace, the original, the second barrel imports and exports": {
    mock: takesOriginal,
    user: byNamespace,
    barrel2: `import { x, y } from "./barrel.js"; export { x, y };`,
    barrel: importsAndExports,
  },
  "renamed twice": {
    mock: `vi.mock("./barrel.js", () => ({ w: "over w" }));`,
    user: `import { z } from "./barrel2.js"; import * as ns from "./barrel2.js";
export const seen = () => [z, ns.z, Object.keys(ns).join("+")].join(" ");`,
    barrel2: `export { w as z } from "./barrel.js";`,
    barrel: `export { x as w } from "./leaf.js";`,
  },
  "three barrels": {
    mock: plainFactory,
    user: `import { x, y } from "./barrel3.js";
export const seen = () => [x, y].join(" ");`,
    barrel2: secondByName,
    barrel: exportsFrom,
  },
  "one name through the mock, one past it": {
    mock: plainFactory,
    user: byName,
    barrel2: `export { x } from "./barrel.js"; export { y } from "./leaf.js";`,
    barrel: exportsFrom,
  },
  "the second barrel imports a helper that imports the leaf": {
    mock: plainFactory,
    user: byNamespace,
    barrel2: `import "./helper.js"; ${secondByName}`,
    barrel: exportsFrom,
  },
  "the second barrel hands on a name of a file that imports the leaf": {
    mock: plainFactory,
    user: `import * as ns from "./barrel2.js";
const key = JSON.parse('"x"');
export const seen = () => [ns.x, ns[key], ns.helped, Object.keys(ns).sort().join("+")].join(" ");`,
    barrel2: `export { x } from "./barrel.js"; export { helped } from "./helper.js";`,
    barrel: exportsFrom,
  },
  "a star over a barrel whose own object nobody reads": {
    mock: plainFactory,
    user: byNamespace,
    barrel2: `export * from "./named.js"; export const second = "second";`,
    barrel: `export * from "./leaf.js";`,
  },
  "the mocked barrel declares": { mock: takesOriginal, user: byNamespace, barrel2: secondByName, barrel: leaf },
  "no mock": { mock: "", user: byNamespace, barrel2: secondByName, barrel: exportsFrom },
  "a mock of the leaf": {
    mock: `vi.mock("./leaf.js", () => ({ x: "over x", y: "mock y" }));`,
    user: byNamespace,
    barrel2: secondByName,
    barrel: exportsFrom,
  },
};

const ways = ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"];
// On a build in front of the cures five of the projects differed as one program, and this one of them in two layers too.
const differedInLayers = "one name through the mock, one past it";

test.each(Object.keys(projects))(
  "%s: as plain Bun",
  async name => {
    const project = projects[name];
    using dir = tempDir("aot-mock-between-barrels", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "leaf.js": project.leaf ?? leaf,
      "barrel.js": project.barrel,
      "barrel2.js": project.barrel2,
      "barrel3.js": `export { x, y } from "./barrel2.js";`,
      "helper.js": `import { y } from "./leaf.js"; export const helped = () => typeof y;`,
      "named.js": `export { x, y } from "./barrel.js"; export * from "./barrel2.js";`,
      "user.js": project.user,
      "a.test.js": `import { test, vi } from "bun:test";
${project.mock}
import { seen } from "./user.js";
test("t", () => console.log("SEEN", seen()));`,
    });
    const seen = async (flags: string[], words: string) => {
      const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
      const lines = (stdout + "\n" + stderr).split("\n");
      return lines.filter(line => line.startsWith("SEEN") || /^warn: TS\d+/.test(line) || /^(\w*Error): /.test(line));
    };
    const plain = await seen([], "");
    expect(plain.length).toBeGreaterThan(0);
    for (const words of waysFor(ways, name === differedInLayers)) expect(await seen(["--aot"], words)).toEqual(plain);
  },
  600000,
);
