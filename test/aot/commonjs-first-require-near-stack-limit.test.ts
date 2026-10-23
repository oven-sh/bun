import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// A CommonJS module that is first required where the stack ends: the RangeError comes before its first statement. Whoever requires it
// later gets the whole object, as in `bun run`: the module is evaluated again. An executable built without --aot hands out the empty
// one that the bundle's wrapper had made by then. A module of an --aot executable whose body has begun does not run again: it keeps the
// RangeError that one of its own statements ran into, so no library here does anything that needs more of the stack than its frame.

const main = `function lazy() { return require("./lib"); }
function dive(n) { try { return dive(n + 1); } catch (e) { return lazy(); } }
let first; try { first = dive(0); } catch (e) { first = "threw " + e.name; }
let k; try { k = lazy(); } catch (e) { k = "threw " + e.name; }
console.log(typeof k, k && typeof k === "object" ? Object.keys(k).join() : String(k));
let again; try { again = lazy(); } catch (e) { again = "threw " + e.name; }
console.log(again === k, typeof again);
`;

const libraries: Record<string, Record<string, string>> = {
  "only-values": {
    "lib.js": `"use strict";\nconst keys = { kState: Symbol("state"), kOptions: Symbol("options") };\nmodule.exports = keys;\n`,
  },
  "a-function-too": {
    "lib.js": `"use strict";\nlet n = 0;\nfunction f() { return n++; }\nmodule.exports = { f, kState: Symbol("state") };\n`,
  },
  "exports-dot": {
    "lib.js": `"use strict";\nexports.kState = Symbol("state");\nexports.kOptions = Symbol("options");\n`,
  },
  "a-class": {
    "lib.js": `"use strict";\nclass Box { constructor(v) { this.v = v; } }\nmodule.exports = { Box, kState: Symbol("state") };\n`,
  },
  "it-requires-another": {
    "lib.js": `"use strict";\nconst other = require("./other");\nmodule.exports = { kState: Symbol("state"), other };\n`,
    "other.js": `"use strict";\nmodule.exports = { kOther: Symbol("other") };\n`,
  },
};

describe.concurrent.each(Object.keys(libraries))("%s", name => {
  test("an executable built with --aot answers as bun run", async () => {
    using dir = tempDir("first-required-at-the-end-of-the-stack", { "main.js": main, ...libraries[name] });
    const run = async (cmd: string[]) => {
      const { stdout, stderr, exitCode } = await runCommand(cmd, String(dir));
      return { stdout, stderr, exitCode };
    };
    const built = async (flags: string[], outfile: string) => {
      const build = await run([bunExe(), "build", "--compile", ...flags, "main.js", "--outfile", outfile]);
      expect(build.stderr).not.toContain("error");
      expect(build.exitCode).toBe(0);
      return run([join(String(dir), outfile)]);
    };
    const plain = await run([bunExe(), "run", "main.js"]);
    const compiled = await built(["--aot"], "compiled");
    expect(plain.exitCode).toBe(0);
    expect(compiled.stdout).toBe(plain.stdout);
    expect(compiled.exitCode).toBe(0);
  });
});
