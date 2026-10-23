import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// `module.children` lists every CommonJS module that the module has required, also one that another module had loaded before.

const files = {
  "lib/names.js": `exports.names = module => module.children.map(child => child.id.split(/[\\\\/]/).pop()).join();`,
  "lib/shared.js": `exports.loads = globalThis.loads = (globalThis.loads || 0) + 1;`,
  "lib/first.js": `const { names } = require("./names.js");
exports.shared = require("./shared.js");
exports.children = () => names(module);
`,
  "lib/second.js": `const { names } = require("./names.js");
exports.shared = require("./shared.js");
exports.again = require("./shared.js");
exports.late = () => require("./late.js");
exports.children = () => names(module);
`,
  "lib/late.js": `exports.late = true;`,
  "lib/child.js": `console.log("in the child:", module.parent.children.length, module.parent.children.includes(module));`,
  "lib/thrower.js": `console.log("in the thrower:", module.parent.children.length);
throw new Error("thrown by the child");
`,
  "lib/left.js": `exports.right = require("./right.js"); exports.children = () => module.children.length;`,
  "lib/right.js": `exports.left = require("./left.js"); exports.children = () => module.children.length;`,
};

const programs: Record<string, string> = {
  "loaded-by-another-first.cjs": `const { names } = require("./lib/names.js");
const first = require("./lib/first.js"), second = require("./lib/second.js");
console.log(names(module), "|", first.children(), "|", second.children());
second.late(); second.late();
console.log(second.children(), "|", module.children.every(child => child.parent === module));
`,
  "listed-once-it-is-evaluated.cjs": `const { names } = require("./lib/names.js");
require("./lib/child.js");
console.log(names(module));
require("./lib/child.js");
console.log(names(module));
`,
  "a-child-that-threw-is-not-listed.cjs": `const { names } = require("./lib/names.js");
try {
  require("./lib/thrower.js");
} catch (error) {
  console.log(error.message, "|", names(module));
}
require("./lib/late.js");
console.log(names(module));
`,
  "a-cycle.cjs": `const left = require("./lib/left.js");
console.log(left.children(), left.right.children(), module.children.length);
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("children-of-modules", { ...files, [entry]: programs[entry] });
    const run = async (flags: string[]) => {
      const { stdout, stderr, exitCode } = await runCommand([bunExe(), "run", ...flags, entry], String(dir));
      return { stdout, stderr, exitCode };
    };
    const [plain, aot] = [await run([]), await run(["--debug-aot"])];
    expect(plain.exitCode).toBe(0);
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
