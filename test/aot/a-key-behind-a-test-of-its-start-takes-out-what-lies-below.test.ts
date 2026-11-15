import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `for (const key of Object.keys(require.cache)) if (key.startsWith(dirname(require.resolve("kit")) + sep)) delete require.cache[key]`, as a test lets a package load once more.
// Wherever the key comes from, what is taken out there lies below that folder, and the build can read the folder once it knows where "kit" was found.
// It counted as a key that nobody reads: then every file of the run is one whose body may run again, and none is compiled as in the executable.
// The shapes that begin with UNREAD are the controls: there every file may still load again. Each shape is a project of its own, held against plain `bun test`.
const common: Record<string, string> = {
  "node_modules/kit/index.js": `const part = require("./lib/part.js");
let own = 0;
exports.tick = () => [++own, part.bump()];
console.log("SEEN kit runs");
`,
  "node_modules/kit/lib/part.js": `let count = 0;
exports.bump = () => ++count;
console.log("SEEN part runs");
`,
  "node_modules/kit/node_modules/nested/index.js": `exports.nested = true;
`,
  "node_modules/kit/node_modules/nested/package.json": `{ "name": "nested", "main": "index.js" }
`,
  "node_modules/kit/package.json": `{ "name": "kit", "main": "index.js" }
`,
  "other.ts": `let count = 0;
export const bump = () => ++count;
console.log("SEEN other runs");
`,
  "package.json": `{ "name": "p", "type": "module" }
`,
};

const shapes: Record<string, Record<string, string>> = {
  "UNREAD-a-start-that-nobody-reads": {
    "a.test.ts": `import { test } from "bun:test";
import { dirname, join, sep } from "path";
import * as path from "node:path";
import { bump } from "./other";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = require("kit");
  say(first.tick(), bump());
  for (const cachedPath of Object.keys(require.cache)) {
    if (cachedPath.startsWith(process.env.NOBODY_SETS_THIS ?? dirname(require.resolve("kit")))) {
      delete require.cache[cachedPath];
    }
  }
  const again = (await import("kit")).default;
  say(again.tick(), again.tick === first.tick, first.tick(), bump());
});
`,
  },
  "UNREAD-the-test-asks-for-the-end": {
    "a.test.ts": `import { test } from "bun:test";
import { dirname, join, sep } from "path";
import * as path from "node:path";
import { bump } from "./other";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = require("kit");
  say(first.tick(), bump());
  for (const cachedPath of Object.keys(require.cache)) {
    if (cachedPath.endsWith("kit/index.js") || cachedPath.endsWith("part.js")) {
      delete require.cache[cachedPath];
    }
  }
  const again = (await import("kit")).default;
  say(again.tick(), again.tick === first.tick, first.tick(), bump());
});
`,
  },
  "a-slash-in-the-place-of-sep": {
    "a.test.ts": `import { test } from "bun:test";
import { dirname, join, sep } from "path";
import * as path from "node:path";
import { bump } from "./other";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = require("kit");
  say(first.tick(), bump());
  for (const cachedPath of Object.keys(require.cache)) {
    if (cachedPath.startsWith(dirname(require.resolve("kit")) + "/")) {
      delete require.cache[cachedPath];
    }
  }
  const again = (await import("kit")).default;
  say(again.tick(), again.tick === first.tick, first.tick(), bump());
});
`,
  },
  "by-a-callback": {
    "a.test.ts": `import { test } from "bun:test";
import { dirname, join, sep } from "path";
import * as path from "node:path";
import { bump } from "./other";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = require("kit");
  say(first.tick(), bump());
  const folder = dirname(require.resolve("kit")) + sep;
  Object.keys(require.cache).forEach(key => { if (key.startsWith(folder)) delete require.cache[key]; });
  const again = (await import("kit")).default;
  say(again.tick(), again.tick === first.tick, first.tick(), bump());
});
`,
  },
  "in-a-helper": {
    "a.test.ts": `import { test } from "bun:test";
import { dirname, join, sep } from "path";
import * as path from "node:path";
import { bump } from "./other";
import { evict } from "./helper";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = require("kit");
  say(first.tick(), bump());
  evict();
  const again = (await import("kit")).default;
  say(again.tick(), again.tick === first.tick, first.tick(), bump());
});
`,
    "helper.ts": `import { dirname, sep } from "path";
export function evict() {
  const folder = dirname(require.resolve("kit")) + sep;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(folder)) delete require.cache[key];
  }
}
`,
  },
  "the-folder-above-the-folder": {
    "a.test.ts": `import { test } from "bun:test";
import { dirname, join, sep } from "path";
import * as path from "node:path";
import { bump } from "./other";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = require("kit");
  say(first.tick(), bump());
  for (const cachedPath of Object.keys(require.cache)) {
    if (cachedPath.startsWith(dirname(dirname(require.resolve("kit/lib/part.js"))) + sep)) {
      delete require.cache[cachedPath];
    }
  }
  const again = (await import("kit")).default;
  say(again.tick(), again.tick === first.tick, first.tick(), bump());
});
`,
  },
  "the-folder-of-a-package-and-not-what-is-nested-in-it": {
    "a.test.ts": `import { test } from "bun:test";
import { dirname, join, sep } from "path";
import * as path from "node:path";
import { bump } from "./other";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = require("kit");
  say(first.tick(), bump());
  const folder = dirname(require.resolve("kit")) + sep;
  const nested = join(folder, "node_modules") + sep;
  for (const cachedPath of Object.keys(require.cache)) {
    if (cachedPath.startsWith(folder) && !cachedPath.startsWith(nested)) {
      delete require.cache[cachedPath];
    }
  }
  const again = (await import("kit")).default;
  say(again.tick(), again.tick === first.tick, first.tick(), bump());
});
`,
  },
  "the-folder-written-in-the-test": {
    "a.test.ts": `import { test } from "bun:test";
import { dirname, join, sep } from "path";
import * as path from "node:path";
import { bump } from "./other";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = require("kit");
  say(first.tick(), bump());
  for (const cachedPath of Object.keys(require.cache)) {
    if (cachedPath.startsWith(path.dirname(require.resolve("kit")) + path.sep)) {
      delete require.cache[cachedPath];
    }
  }
  const again = (await import("kit")).default;
  say(again.tick(), again.tick === first.tick, first.tick(), bump());
});
`,
  },
  "the-path-of-the-file-itself": {
    "a.test.ts": `import { test } from "bun:test";
import { dirname, join, sep } from "path";
import * as path from "node:path";
import { bump } from "./other";
test("a", async () => {
  const say = (...all: unknown[]) => console.log("SEEN", JSON.stringify(all));
  const first = require("kit");
  say(first.tick(), bump());
  for (const cachedPath of Object.keys(require.cache)) {
    if (cachedPath.startsWith(require.resolve("kit"))) {
      delete require.cache[cachedPath];
    }
  }
  const again = (await import("kit")).default;
  say(again.tick(), again.tick === first.tick, first.tick(), bump());
});
`,
  },
};

for (const [name, files] of Object.entries(shapes)) {
  test.concurrent(
    `keys that start with a folder are taken out of require.cache: ${name}`,
    async () => {
      using dir = tempDir("aot-keys-below-a-folder", { ...common, ...files });
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
      expect(plain.seen.lines.length).toBeGreaterThan(3);
      expect(plain.seen.exitCode).toBe(0);
      expect(compiled.seen).toEqual(plain.seen);
      expect(compiled.everyFile).toBe(name.startsWith("UNREAD-"));
    },
    120_000,
  );
}
