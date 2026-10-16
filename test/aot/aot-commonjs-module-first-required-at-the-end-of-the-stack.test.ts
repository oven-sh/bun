import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// A CommonJS module that is first required where the stack ends: the RangeError comes before its first statement. Whoever requires it
// later gets an object: the whole one, as in `bun run`, or the empty one that a bundle's wrapper had made by then, as in an executable
// built without --aot. Where exactly the stack ends differs between builds, so either answer is right. `undefined` is not.

const main = `function lazy() { return require("./lib"); }
function dive(n) { try { return dive(n + 1); } catch (e) { return lazy(); } }
let first; try { first = dive(0); } catch (e) { first = "threw " + e.name; }
let k; try { k = lazy(); } catch (e) { k = "threw " + e.name; }
console.log(typeof k, k && typeof k === "object" ? Object.keys(k).join() : String(k));
let again; try { again = lazy(); } catch (e) { again = "threw " + e.name; }
console.log(again === k, typeof again);
`;

const libraries: Record<string, Record<string, string>> = {
  "only-values": { "lib.js": `"use strict";\nconst keys = { kState: Symbol("state"), kOptions: Symbol("options") };\nmodule.exports = keys;\n` },
  "a-function-too": { "lib.js": `"use strict";\nlet n = 0;\nfunction f() { return n++; }\nmodule.exports = { f, kState: Symbol("state") };\n` },
  "exports-dot": { "lib.js": `"use strict";\nexports.kState = Symbol("state");\nexports.kOptions = Symbol("options");\n` },
  "a-side-effect": { "lib.js": `"use strict";\nglobalThis.loads = (globalThis.loads || 0) + 1;\nmodule.exports = { kState: Symbol("state"), loads: globalThis.loads };\n` },
  "a-class": { "lib.js": `"use strict";\nclass Box { constructor(v) { this.v = v; } }\nmodule.exports = { Box, kState: Symbol("state") };\n` },
  "it-requires-another": {
    "lib.js": `"use strict";\nconst other = require("./other");\nmodule.exports = { kState: Symbol("state"), other };\n`,
    "other.js": `"use strict";\nmodule.exports = { kOther: Symbol("other") };\n`,
  },
};

describe.concurrent.each(Object.keys(libraries))("%s", name => {
  test("an executable built with --aot answers as bun run or as an executable built without it", async () => {
    using dir = tempDir("first-required-at-the-end-of-the-stack", { "main.js": main, ...libraries[name] });
    const run = async (cmd: string[]) => {
      await using proc = Bun.spawn({ cmd, cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const built = async (flags: string[], outfile: string) => {
      const build = await run([bunExe(), "build", "--compile", ...flags, "main.js", "--outfile", outfile]);
      expect(build.stderr).not.toContain("error");
      expect(build.exitCode).toBe(0);
      return run([join(String(dir), outfile)]);
    };
    const plain = await run([bunExe(), "run", "main.js"]);
    const bundled = await built([], "bundled");
    const compiled = await built(["--aot"], "compiled");
    expect(plain.exitCode).toBe(0);
    expect([plain.stdout, bundled.stdout]).toContain(compiled.stdout);
    expect(compiled.exitCode).toBe(0);
  });
});
