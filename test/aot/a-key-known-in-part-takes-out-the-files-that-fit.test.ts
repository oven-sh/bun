import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `const key = path.join(root, process.platform, "addon.node"); require.cache[key] = fake; .. delete require.cache[key]`, as a test puts a fake in the place of a native addon.
// The build knows how the key ends, so what is taken out is a file whose path ends so: here none of the program.
// It counted as a key that nobody reads: then every file of the run is one whose body may run again, and none is compiled as in the executable.
// Where the part that is spelled fits a file of the program, that file is taken out and loads once more, as in plain `bun test`.
// The shape that begins with UNREAD is the control: there every file may still load again. Each shape is a project of its own.
const common: Record<string, string> = {
  "lib/state.cjs": `let own = 0;
exports.tick = () => ++own;
console.log("SEEN state runs");
`,
  "loads.cjs": `const path = require("node:path");
exports.native = root => require(path.join(root, process.platform, "addon.node"));
`,
  "other.ts": `let count = 0;
export const bump = () => ++count;
console.log("SEEN other runs");
`,
  "package.json": `{ "name": "p", "type": "module" }
`,
};

const shapes: Record<string, string> = {
  "UNREAD-nothing-of-the-key-is-spelled": `import { afterEach, test } from "bun:test";
import * as path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { bump } from "./other";
import { native } from "./loads.cjs";
const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
const makeRoot = () => { const root = mkdtempSync(path.join(tmpdir(), "parts-")); mkdirSync(path.join(root, process.platform)); writeFileSync(path.join(root, process.platform, "addon.node"), ""); return root; };
test("a", () => {
  const first = require("./lib/state.cjs");
  say(first.tick(), bump());
  delete require.cache[path.join(process.env.NOBODY_SETS_THIS ?? import.meta.dir, process.env.NOR_THIS ?? "lib/state.cjs")];
  const again = require("./lib/state.cjs");
  say(again.tick(), again === first, first.tick(), bump());
});
`,
  "a-fake-addon-under-a-constant-name": `import { afterEach, test } from "bun:test";
import * as path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { bump } from "./other";
import { native } from "./loads.cjs";
const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
const makeRoot = () => { const root = mkdtempSync(path.join(tmpdir(), "parts-")); mkdirSync(path.join(root, process.platform)); writeFileSync(path.join(root, process.platform, "addon.node"), ""); return root; };
test("a", () => {
  const root = makeRoot();
  const modulePath = path.join(root, process.platform, "addon.node");
  const entry = { id: modulePath, filename: modulePath, loaded: true } as NodeJS.Module;
  let loads = 0;
  Object.defineProperty(entry, "exports", { configurable: true, enumerable: true, get: () => { loads++; return { fake: 3 }; } });
  require.cache[modulePath] = entry;
  say(native(root), loads, bump());
  delete require.cache[modulePath];
  say(Object.keys(require.cache).includes(modulePath));
});
`,
  "a-fake-addon-under-a-name-that-is-stored-later": `import { afterEach, test } from "bun:test";
import * as path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { bump } from "./other";
import { native } from "./loads.cjs";
const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
const makeRoot = () => { const root = mkdtempSync(path.join(tmpdir(), "parts-")); mkdirSync(path.join(root, process.platform)); writeFileSync(path.join(root, process.platform, "addon.node"), ""); return root; };
let seeded: string | undefined;
function seed(root: string, fake: object) {
  seeded = path.join(root, process.platform, "addon.node");
  require.cache[seeded] = { id: seeded, filename: seeded, loaded: true, exports: fake } as NodeJS.Module;
}
afterEach(() => {
  if (seeded) {
    delete require.cache[seeded];
    seeded = undefined;
  }
});
test("a", () => {
  const root = makeRoot();
  seed(root, { fake: 1 });
  say(native(root), bump());
});
test("b", () => {
  const root = makeRoot();
  seed(root, { fake: 2 });
  say(native(root), bump());
});
`,
  "the-end-names-a-file-of-the-program": `import { afterEach, test } from "bun:test";
import * as path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { bump } from "./other";
import { native } from "./loads.cjs";
const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
const makeRoot = () => { const root = mkdtempSync(path.join(tmpdir(), "parts-")); mkdirSync(path.join(root, process.platform)); writeFileSync(path.join(root, process.platform, "addon.node"), ""); return root; };
test("a", () => {
  const first = require("./lib/state.cjs");
  say(first.tick(), bump());
  delete require.cache[path.join(import.meta.dir, process.env.NOBODY_SETS_THIS ?? "lib", "state.cjs")];
  const again = require("./lib/state.cjs");
  say(again.tick(), again === first, first.tick(), bump());
});
`,
  "the-start-names-a-folder-of-the-program": `import { afterEach, test } from "bun:test";
import * as path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { bump } from "./other";
import { native } from "./loads.cjs";
const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
const makeRoot = () => { const root = mkdtempSync(path.join(tmpdir(), "parts-")); mkdirSync(path.join(root, process.platform)); writeFileSync(path.join(root, process.platform, "addon.node"), ""); return root; };
test("a", () => {
  const first = require("./lib/state.cjs");
  say(first.tick(), bump());
  delete require.cache[import.meta.dir + "/lib/" + (process.env.NOBODY_SETS_THIS ?? "state.cjs")];
  const again = require("./lib/state.cjs");
  say(again.tick(), again === first, first.tick(), bump());
});
`,
};

for (const [name, testFile] of Object.entries(shapes)) {
  test.concurrent(
    `a key of require.cache of which a part is spelled: ${name}`,
    async () => {
      using dir = tempDir("aot-keys-known-in-part", { ...common, "a.test.ts": testFile });
      const seenWith = async (...flags: string[]) => {
        const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
        return {
          seen: {
            lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
            failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|Error/.test(line)),
            exitCode,
          },
          everyFile: (stdout + stderr).includes("every file may load again"),
        };
      };
      const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
      expect(plain.seen.lines.length).toBeGreaterThan(2);
      expect(plain.seen.exitCode).toBe(0);
      expect(compiled.seen).toEqual(plain.seen);
      expect(compiled.everyFile).toBe(name.startsWith("UNREAD-"));
    },
    120_000,
  );
}
