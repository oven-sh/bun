import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Two `export *` of a barrel bring the same name. Without a mock the name is ambiguous, and the barrel does not have it. What a mock gives makes no name ambiguous:
// the first star that has the name keeps it, as in Vitest. Here the mocked file is reached through a ring of stars. The other forms are cases of
// fixed-runs/isolated: stars-clash-beside-a-mock and stars-clash-under-a-mock-laid-over. This one is wrong there today, beside a mock under a computed name.
const files = {
  "package.json": `{ "type": "module" }`,
  "clash.js": `export const x = "clash x";\nexport const other = "other";`,
  "dep.js": `export const x = "real x";\nexport const f = "real f";`,
  "ring.js": `export * from "./dep.js";\nexport * from "./barrel.js";\nexport const r = "r";`,
  "barrel.js": `export * from "./clash.js";\nexport * from "./ring.js";`,
  "user.js": `import * as barrel from "./barrel.js";
export const seen = () => "x=" + barrel.x + " f=" + barrel.f + " keys=" + Object.keys(barrel).join("+");`,
  "a.test.js": `import { test, vi } from "bun:test";
vi.mock("./dep.js", () => ({ x: "mock x", f: "mock f" }));
import { seen } from "./user.js";
test("t", () => console.log("SEEN", seen()));`,
};

test.each([
  ["bun test", []],
  ["one program", ["--aot"]],
])(
  "a ring of stars with the mock in it: %s",
  async (_, flags) => {
    using directory = tempDir("aot-mock-star-clash", files);
    const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(directory), { ...bunEnv, NO_COLOR: "1" });
    expect((stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN "))).toEqual([
      "SEEN x=clash x f=mock f keys=f+other+r+x",
    ]);
  },
  180_000,
);
