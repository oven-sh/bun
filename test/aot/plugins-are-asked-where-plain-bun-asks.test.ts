import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Plain Bun asks the onResolve callbacks about a name once, when the file that writes it has been fetched: jobs behind the import() that began the load, before any file of the graph runs, and never about what
// a mock keeps from loading. A compiled file is bound at the build, so the run time asks ahead of the link, and the file runs from source where a callback answers. Each project prints what it got and whom
// the callback was asked about, and both are held against `bun test`.
const projects: Record<string, Record<string, string>> = {
  "a callback requires a file above a file that is still to be asked about": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("the callback requires a file above a listed file", async () => {
  const asked = [];
  plugin({ name: "loads", setup(build) {
    build.onResolve({ filter: /^\\.\\/(trigger|part)\\.js$/ }, args => {
      asked.push(args.path + "<" + args.importer.split("/").pop());
      if (args.path === "./part.js") return { path: import.meta.dir + "/src/fake.js" };
      globalThis.early = require("./src/side.js").kind;
    });
  } });
  console.log("SAID", (await import("./src/one.js")).kind, globalThis.early, "|", asked.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fake.js": `export const kind = "fake";`,
    "src/one.js": `import "./trigger.js";
export { kind } from "./two.js";`,
    "src/part.js": `export const kind = "real";`,
    "src/side.js": `export { kind } from "./two.js";`,
    "src/trigger.js": `export {};`,
    "src/two.js": `import { kind as found } from "./part.js";
export const kind = found;`,
  },
  "a callback registers the plugin that answers for a later file of the graph": {
    "a.test.js": `import { test } from "bun:test";
import { kind } from "./src/first.js";
test("a plugin that a callback registers", () => {
  console.log("SAID", kind, "|", globalThis.asked.join(" "));
});`,
    "bunfig.toml": `[test]
preload = ["./setup.js"]`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "setup.js": `import { plugin } from "bun";
globalThis.asked = [];
const said = args => globalThis.asked.push(args.path + "<" + args.importer.split("/").pop());
plugin({ name: "first", setup(build) {
  build.onResolve({ filter: /^\\.\\/trigger\\.js$/ }, args => {
    said(args);
    plugin({ name: "second", setup(later) {
      later.onResolve({ filter: /^\\.\\/part\\.js$/ }, asks => (said(asks), { path: "part", namespace: "made" }));
      later.onLoad({ filter: /.*/, namespace: "made" }, () => ({ exports: { kind: "fake" }, loader: "object" }));
    } });
  });
} });`,
    "src/first.js": `import "./trigger.js";
export { kind } from "./second.js";`,
    "src/part.js": `export const kind = "real";`,
    "src/second.js": `import { kind as found } from "./part.js";
export const kind = found;`,
    "src/trigger.js": `export {};`,
  },
  "what the callback goes by turns right behind the call of import()": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("the state turns right behind the call", async () => {
  const asked = [];
  let mode = "real";
  plugin({ name: "by mode", setup(build) {
    build.onResolve({ filter: /^\\.\\/part\\.js$/ }, args => {
      asked.push(mode + ":" + args.importer.split("/").pop());
      return mode === "fake" ? { path: "part", namespace: "made" } : undefined;
    });
    build.onLoad({ filter: /.*/, namespace: "made" }, () => ({ exports: { kind: "fake" }, loader: "object" }));
  } });
  const loading = import("./src/user.js");
  mode = "fake";
  console.log("SAID", (await loading).kind, "|", asked.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/part.js": `export const kind = "real";`,
    "src/user.js": `import { kind as found } from "./part.js";
export const kind = found;`,
  },
  "a callback starts an import() of a file that writes a bare name": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a load that a callback starts", async () => {
  const asked = [];
  plugin({ name: "starts a load", setup(build) {
    build.onResolve({ filter: /^(dep|\\.\\/src\\/one\\.js)$/ }, args => {
      asked.push(args.path + "<" + args.importer.split("/").pop());
      if (args.path === "dep") return { path: "dep", namespace: "made" };
      globalThis.later = import("./src/helper.js");
    });
    build.onLoad({ filter: /.*/, namespace: "made" }, () => ({ exports: { kind: "fake" }, loader: "object" }));
  } });
  await import("./src/one.js");
  console.log("SAID", (await globalThis.later).kind, "|", asked.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "node_modules/dep/index.js": `export const kind = "real";`,
    "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "type": "module", "main": "index.js" }`,
    "src/helper.js": `import { kind as found } from "dep";
export const kind = found;`,
    "src/one.js": `export {};`,
  },
  "what only the original of a mocked module imports is asked about when it loads": {
    "a.test.js": `import { plugin } from "bun";
import { mock, test } from "bun:test";
const asked = [];
let mode = "real";
plugin({ name: "by mode", setup(build) {
  build.onResolve({ filter: /^\\.\\/part\\.js$/ }, args => {
    asked.push(mode + ":" + args.importer.split("/").pop());
    return mode === "fake" ? { path: "part", namespace: "made" } : undefined;
  });
  build.onLoad({ filter: /.*/, namespace: "made" }, () => ({ exports: { kind: "fake" }, loader: "object" }));
} });
test("a mock stands over the importer", async () => {
  mock.module("./src/top.js", () => ({ told: () => "mocked" }));
  console.log("SAID", (await import("./src/top.js")).told(), "|", asked.join(" "));
});
test("what the original imports loads later", async () => {
  mode = "fake";
  console.log("SAID", (await import("./src/user.js")).kind, "|", asked.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/part.js": `export const kind = "real";`,
    "src/top.js": `import { kind } from "./user.js";
export const told = () => "top " + kind;`,
    "src/user.js": `import { kind as found } from "./part.js";
export const kind = found;`,
  },
  "a file that only the original of a mocked module imports is not of the graph that runs": {
    "a.test.js": `import { mock, test } from "bun:test";
test("a file that only the original of a mocked module imports", async () => {
  mock.module("./src/wrapped.js", () => ({ told: () => "mocked" }));
  const top = await import("./src/top.js");
  console.log("SAID IS", top.told(), globalThis.early, globalThis.loads);
  console.log("SAID ASKED", [...new Set(globalThis.asked)].join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fake.js": `export const kind = "fake";`,
    "src/first.js": `import { plugin } from "bun";
globalThis.asked = [];
plugin({ name: "late", setup(build) {
  build.onResolve({ filter: /^\\.\\/part\\.js$/ }, args => {
    globalThis.asked.push(args.path + "<" + args.importer.split("/").pop());
    return { path: import.meta.dir + "/fake.js" };
  });
} });
globalThis.early = require("./user.js").kind;`,
    "src/part.js": `export const kind = "real";`,
    "src/top.js": `import "./first.js";
import { told as shown } from "./wrapped.js";
export const told = () => shown();`,
    "src/user.js": `import { kind as found } from "./part.js";
globalThis.loads = (globalThis.loads ?? 0) + 1;
export const kind = found;`,
    "src/wrapped.js": `import { kind } from "./user.js";
export const told = () => "wrapped " + kind;`,
  },
  "the root of the graph that runs was required": {
    "a.test.js": `import { test } from "bun:test";
test("the root is required, not imported", () => {
  const top = require("./src/top.js");
  console.log("SAID IS", top.told(), globalThis.early, globalThis.loads);
  console.log("SAID ASKED", [...new Set(globalThis.asked)].join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fake.js": `export const kind = "fake";`,
    "src/first.js": `import { plugin } from "bun";
globalThis.asked = [];
plugin({ name: "late", setup(build) {
  build.onResolve({ filter: /^\\.\\/part\\.js$/ }, args => {
    globalThis.asked.push(args.path + "<" + args.importer.split("/").pop());
    return { path: import.meta.dir + "/fake.js" };
  });
} });
globalThis.early = require("./user.js").kind;`,
    "src/part.js": `export const kind = "real";`,
    "src/top.js": `import "./first.js";
import { kind } from "./user.js";
export const told = () => kind;`,
    "src/user.js": `import { kind as found } from "./part.js";
globalThis.loads = (globalThis.loads ?? 0) + 1;
export const kind = found;`,
  },
  "a graph whose first file threw stays resolved": {
    "a.test.js": `import { test } from "bun:test";
test("a graph that began and threw", async () => {
  const first = await import("./src/top.js").then(() => "loaded", error => error.message);
  const kind = (await import("./src/user.js")).kind;
  console.log("SAID IS", first, kind, globalThis.loads);
  console.log("SAID ASKED", [...new Set(globalThis.asked)].join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fake.js": `export const kind = "fake";`,
    "src/first.js": `import { plugin } from "bun";
globalThis.asked = [];
plugin({ name: "late", setup(build) {
  build.onResolve({ filter: /^\\.\\/part\\.js$/ }, args => {
    globalThis.asked.push(args.path + "<" + args.importer.split("/").pop());
    return { path: import.meta.dir + "/fake.js" };
  });
} });
throw new Error("stop");`,
    "src/part.js": `export const kind = "real";`,
    "src/top.js": `import "./first.js";
import { kind } from "./user.js";
export const told = () => kind;`,
    "src/user.js": `import { kind as found } from "./part.js";
globalThis.loads = (globalThis.loads ?? 0) + 1;
export const kind = found;`,
  },
  "a callback that answers the first time alone": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("the callback answers the first time alone", async () => {
  const asked = [];
  plugin({ name: "once", setup(build) {
    build.onResolve({ filter: /^\\.\\/part\\.js$/ }, args => {
      const answer = asked.length === 0 ? { path: "part", namespace: "made" } : undefined;
      asked.push(args.path + "<" + args.importer.split("/").pop() + "=" + (answer ? "made" : "none"));
      return answer;
    });
    build.onLoad({ filter: /.*/, namespace: "made" }, () => ({ exports: { kind: "fake" }, loader: "object" }));
  } });
  console.log("SAID", (await import("./src/user.js")).kind, "|", asked.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/part.js": `export const kind = "real";`,
    "src/user.js": `import { kind as found } from "./part.js";
export const kind = found;`,
  },
  "a callback that throws the first time alone": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("the callback throws the first time alone", async () => {
  const asked = [];
  plugin({ name: "not yet", setup(build) {
    build.onResolve({ filter: /^\\.\\/part\\.js$/ }, args => {
      asked.push(args.path + "<" + args.importer.split("/").pop());
      if (asked.length === 1) throw new Error("not yet");
    });
  } });
  const said = await import("./src/user.js").then(it => it.kind, error => error.message);
  console.log("SAID", said, "|", asked.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/part.js": `export const kind = "real";`,
    "src/user.js": `import { kind as found } from "./part.js";
export const kind = found;`,
  },
  "a callback that answers the very file that the build linked": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
import { dirname, join } from "node:path";
test("the callback answers what the build found", async () => {
  let asked = 0;
  plugin({ name: "resolves itself", setup(build) {
    build.onResolve({ filter: /^\\.\\.?\\/.*\\.js$/ }, args => (asked++, { path: join(dirname(args.importer), args.path) }));
  } });
  const began = performance.now();
  const sum = (await import("./src/work.js")).sum(30_000_000);
  console.log("SAID", sum, asked, "ms", Math.round(performance.now() - began));
}, 120000);`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/step.js": `export const step = (total, i) => (total + i) | 0;`,
    "src/work.js": `import { step } from "./step.js";
export function sum(turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total = step(total, i);
  return total;
}`,
  },
  "a callback that answers the file that the build linked under a query": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("each importer gets a counter of its own", async () => {
  globalThis.asked = [];
  plugin({ name: "fresh", setup(build) {
    build.onResolve({ filter: /^\\.\\/counter\\.js$/ }, args => {
      const importer = args.importer.split("/").pop();
      globalThis.asked.push(args.path + "<" + importer);
      return { path: import.meta.dir + "/src/counter.js?for=" + importer };
    });
  } });
  const one = await import("./src/one.js");
  const two = await import("./src/two.js");
  console.log("SAID IS", one.next(), one.next(), two.next(), globalThis.loads);
  console.log("SAID ASKED", [...new Set(globalThis.asked)].sort().join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/counter.js": `globalThis.loads = (globalThis.loads ?? 0) + 1;
let count = 0;
export const next = () => ++count;`,
    "src/one.js": `import { next as step } from "./counter.js";
export const next = () => step();`,
    "src/two.js": `import { next as step } from "./counter.js";
export const next = () => step();`,
  },
  "a callback that goes by how often it was asked about the importer above": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a callback that counts how often it is asked", async () => {
  const calls = new Map();
  plugin({ name: "counts", setup(build) {
    build.onResolve({ filter: /^\\.\\/(user|part)\\.js$/ }, args => {
      const key = args.path + "<" + args.importer.split("/").pop();
      calls.set(key, (calls.get(key) ?? 0) + 1);
      if (args.path === "./part.js") return { path: import.meta.dir + "/src/fake.js" };
      if (calls.get(key) > 1) return { path: import.meta.dir + "/src/second.js" };
    });
  } });
  console.log("SAID IS", (await import("./src/top.js")).told());
  console.log("SAID CALLS", [...calls].map(([key, count]) => key + "=" + count).sort().join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fake.js": `export const kind = "fake";`,
    "src/part.js": `export const kind = "real";`,
    "src/second.js": `export const kind = "second";`,
    "src/top.js": `import { kind } from "./user.js";
export const told = () => kind;`,
    "src/user.js": `import { kind as found } from "./part.js";
export const kind = found;`,
  },
  "a file that was answered for and did not leave, and loads again later": {
    "a.test.js": `import { test } from "bun:test";
import "./src/first.js";
import { kind } from "./src/user.js";
test("a second instance is resolved as the plugin stands now", async () => {
  globalThis.mode = "late";
  const again = await import("./src/user.js?" + Date.now());
  console.log("SAID IS", kind, globalThis.early, again.kind);
  console.log("SAID MODES", globalThis.modes.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/first.js": `import { plugin } from "bun";
globalThis.mode = "soon";
globalThis.modes = [];
plugin({ name: "by mode", setup(build) {
  build.onResolve({ filter: /^\\.\\/part\\.js$/ }, () => {
    globalThis.modes.push(globalThis.mode);
    return { path: import.meta.dir + "/" + globalThis.mode + ".js" };
  });
} });
globalThis.early = require("./user.js").kind;`,
    "src/late.js": `export const kind = "late";`,
    "src/part.js": `export const kind = "real";`,
    "src/soon.js": `export const kind = "soon";`,
    "src/user.js": `import { kind as found } from "./part.js";
export const kind = found;`,
  },
  "an import that is written as a require": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("import = require behind a plugin", async () => {
  const asked = [];
  plugin({ name: "swap", setup(build) {
    build.onResolve({ filter: /^dep$/ }, args => {
      asked.push(args.path + "<" + args.importer.split("/").pop());
      return { path: "dep", namespace: "made" };
    });
    build.onLoad({ filter: /.*/, namespace: "made" }, () => ({ exports: { kind: "fake" }, loader: "object" }));
  } });
  console.log("SAID", (await import("./src/user.ts")).seen(), "|", asked.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "node_modules/dep/index.js": `module.exports = { kind: "real" };`,
    "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
    "src/user.ts": `import dep = require("dep");
export const seen = () => dep.kind;`,
  },
  "the name of a shallow file registers the plugin that answers for a deeper file": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a shallow file's name registers the plugin that answers for a deeper file", () => {
  const asked = [];
  const said = args => asked.push(args.path + "<" + args.importer.split("/").pop());
  plugin({ name: "first", setup(build) {
    build.onResolve({ filter: /^\\.\\/trigger\\.js$/ }, args => {
      said(args);
      plugin({ name: "second", setup(later) {
        later.onResolve({ filter: /^\\.\\/part\\.js$/ }, asks => (said(asks), { path: import.meta.dir + "/src/fake.js" }));
      } });
    });
  } });
  console.log("SAID IS", require("./src/root.js").told());
  console.log("SAID ASKED", [...new Set(asked)].sort().join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/a.js": `export { kind } from "./a2.js";`,
    "src/a2.js": `export { kind } from "./deep.js";`,
    "src/b.js": `import "./trigger.js";`,
    "src/deep.js": `export { kind } from "./part.js";`,
    "src/fake.js": `export const kind = "fake";`,
    "src/part.js": `export const kind = "real";`,
    "src/root.js": `import { kind } from "./a.js";
import "./b.js";
export const told = () => kind;`,
    "src/trigger.js": `export {};`,
  },
  "what the build linked below a name that a plugin answers for is asked about by nobody": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("what the build linked below a name", async () => {
  const asked = [];
  plugin({ name: "answers", setup(build) {
    build.onResolve({ filter: /^\\.\\/(part|inner)\\.js$/ }, args => {
      asked.push(args.path + "<" + args.importer.split("/").pop());
      if (args.path === "./part.js") return { path: import.meta.dir + "/src/fake.js" };
    });
  } });
  console.log("SAID IS", (await import("./src/user.js")).kind);
  console.log("SAID ASKED", asked.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fake.js": `export const kind = "fake";`,
    "src/inner.js": `export {};`,
    "src/part.js": `import "./inner.js";
export const kind = "real";`,
    "src/user.js": `export { kind } from "./part.js";`,
  },
  "two statements of one file write one name": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a second instance is resolved as the plugin stands now", async () => {
  let mode = "soon";
  const calls = [];
  plugin({ name: "by mode", setup(build) {
    build.onResolve({ filter: /^\\.\\/(twice|part)\\.js$/ }, args => {
      calls.push(mode + ":" + args.path);
      if (args.path === "./part.js" || mode === "late") return { path: import.meta.dir + "/src/fake-" + args.path.slice(2) };
    });
  } });
  const first = await import("./src/user.js");
  mode = "late";
  const second = await import("./src/user.js?" + Date.now());
  console.log("SAID IS", first.told(), second.told());
  console.log("SAID CALLS", calls.join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fake-part.js": `export const kind = "fake";`,
    "src/fake-twice.js": `export const a = "fake-a", b = "fake-b";`,
    "src/part.js": `export const kind = "real";`,
    "src/twice.js": `export const a = "real-a", b = "real-b";`,
    "src/user.js": `import { a } from "./twice.js";
import { b } from "./twice.js";
import { kind } from "./part.js";
export const told = () => [a, b, kind].join("+");`,
  },
  "the importer above stands on the second of two ways down": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a callback that counts how often it is asked, two ways down", async () => {
  const calls = new Map();
  plugin({ name: "counts", setup(build) {
    build.onResolve({ filter: /^\\.\\/(user|part)\\.js$/ }, args => {
      const key = args.path + "<" + args.importer.split("/").pop();
      calls.set(key, (calls.get(key) ?? 0) + 1);
      if (args.path === "./part.js") return { path: import.meta.dir + "/src/fake.js" };
      if (calls.get(key) > 1) return { path: import.meta.dir + "/src/second.js" };
    });
  } });
  console.log("SAID IS", (await import("./src/top.js")).told());
  console.log("SAID CALLS", [...calls].map(([key, count]) => key + "=" + count).sort().join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fake.js": `export const kind = "fake";`,
    "src/left.js": `export { kind } from "./part.js";`,
    "src/part.js": `export const kind = "real";`,
    "src/right.js": `export { kind } from "./user.js";`,
    "src/second.js": `export const kind = "second";`,
    "src/top.js": `import { kind as left } from "./left.js";
import { kind as right } from "./right.js";
export const told = () => left + " " + right;`,
    "src/user.js": `export { kind } from "./part.js";`,
  },
  "a callback for a deeper name clears the plugins": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a deeper name's callback clears the plugins", async () => {
  const asked = [];
  plugin({ name: "answers, then clears", setup(build) {
    build.onResolve({ filter: /^\\.\\/(part|last)\\.js$/ }, args => {
      asked.push(args.path + "<" + args.importer.split("/").pop());
      if (args.path === "./part.js") return { path: import.meta.dir + "/src/fake.js" };
      plugin.clearAll();
    });
  } });
  console.log("SAID IS", (await import("./src/root.js")).told());
  console.log("SAID ASKED", [...new Set(asked)].sort().join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/closer.js": `import "./last.js";`,
    "src/fake.js": `export const kind = "fake";`,
    "src/last.js": `export {};`,
    "src/mid.js": `import "./closer.js";`,
    "src/part.js": `export const kind = "real";`,
    "src/root.js": `import { kind } from "./user.js";
import "./mid.js";
export const told = () => kind;`,
    "src/user.js": `export { kind } from "./part.js";`,
  },
  "four ways to ask where a name leads": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("four ways to ask where a name leads, beside a plugin", async () => {
  let calls = 0;
  plugin({ name: "answers", setup(build) {
    build.onResolve({ filter: /^(\\.\\/dep\\.cjs|pkg)$/ }, () => (calls++, { path: import.meta.dir + "/src/fake.cjs" }));
  } });
  const user = await import("./src/user.ts");
  console.log("SAID WHERE", user.where());
  console.log("SAID WHERE", user.whereOfPackage());
  console.log("SAID CALLS", calls);
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "node_modules/pkg/index.cjs": `exports.kind = "real";`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "index.cjs" }`,
    "src/dep.cjs": `exports.kind = "real";`,
    "src/fake.cjs": `exports.kind = "fake";`,
    "src/user.ts": `const last = (found: string) => found.split("/").pop();
export const where = () =>
  [
    last(require.resolve("./dep.cjs")),
    last(import.meta.resolve("./dep.cjs")),
    last(import.meta.resolveSync("./dep.cjs")),
    last(Bun.resolveSync("./dep.cjs", import.meta.dir)),
  ].join(" ");
export const whereOfPackage = () =>
  [
    last(require.resolve("pkg")),
    last(import.meta.resolve("pkg")),
    last(import.meta.resolveSync("pkg")),
    last(Bun.resolveSync("pkg", import.meta.dir)),
  ].join(" ");`,
  },
  "a callback that the loader itself calls registers a plugin in the middle of a load": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a callback that the loader itself calls registers a plugin in the middle of a load", () => {
  const calls = new Map();
  plugin({ name: "first", setup(build) {
    build.onResolve({ filter: /^\\.\\/(first|later|once)\\.js$/ }, args => {
      const key = args.path + "<" + args.importer.split("/").pop();
      calls.set(key, (calls.get(key) ?? 0) + 1);
      if (args.path === "./first.js") return { path: import.meta.dir + "/src/fake-first.js" };
      if (args.path === "./later.js") plugin({ name: "second", setup(later) { later.onResolve({ filter: /^\\.\\/nobody\\.js$/ }, () => {}); } });
      if (args.path === "./once.js" && calls.get(key) === 1) return { path: import.meta.dir + "/src/fake-once.js" };
    });
  } });
  console.log("SAID IS", require("./src/root.js").told());
  console.log("SAID CALLS", [...calls].map(([key, count]) => key + "=" + count).sort().join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fake-first.js": `export const one = "fake";`,
    "src/fake-once.js": `export const kind = "fake";`,
    "src/first.js": `export const one = "real";`,
    "src/g.js": `export { kind } from "./once.js";`,
    "src/later.js": `export {};`,
    "src/once.js": `export const kind = "real";`,
    "src/root.js": `import { one } from "./x.js";
import { kind } from "./g.js";
export const told = () => one + " " + kind;`,
    "src/x.js": `export { one } from "./first.js";
import "./later.js";`,
  },
  "two names stand behind an answered name and below a file that leaves, and a deeper name registers a plugin": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a deep name registers a plugin; two shallower names stand behind an answered name and below a file that leaves", () => {
  const asked = [];
  const said = args => asked.push(args.path + "<" + args.importer.split("/").pop());
  plugin({ name: "first", setup(build) {
    build.onResolve({ filter: /^\\.\\/(swapped|trigger)\\.js$/ }, args => {
      said(args);
      if (args.path === "./swapped.js") return { path: import.meta.dir + "/src/other.js" };
      plugin({ name: "second", setup(later) {
        later.onResolve({ filter: /^\\.\\/part\\.js$/ }, asks => (said(asks), { path: import.meta.dir + "/src/fake.js" }));
      } });
    });
  } });
  console.log("SAID IS", require("./src/root.js").told());
  console.log("SAID ASKED", [...new Set(asked)].sort().join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/fa.js": `import "./swapped.js";
export { kind } from "./part.js";`,
    "src/fake.js": `export const kind = "fake";`,
    "src/fb.js": `export { kind } from "./x.js";
import "./swapped.js";`,
    "src/g.js": `import "./g2.js";`,
    "src/g2.js": `import "./g3.js";`,
    "src/g3.js": `import "./trigger.js";`,
    "src/other.js": `export {};`,
    "src/part.js": `export const kind = "real";`,
    "src/root.js": `import { kind as behind } from "./fa.js";
import { kind as below } from "./fb.js";
import "./g.js";
export const told = () => [behind, below].join(" ");`,
    "src/swapped.js": `export { kind } from "./part.js";`,
    "src/trigger.js": `export {};`,
    "src/x.js": `export { kind } from "./part.js";`,
  },
  "a file that stays compiled is fetched behind another compiled file": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a file that stays compiled is asked about once", () => {
  const calls = new Map();
  plugin({ name: "counts", setup(build) {
    build.onResolve({ filter: /^\\.\\/(swapped|two)\\.js$/ }, args => {
      const key = args.path + "<" + args.importer.split("/").pop();
      calls.set(key, (calls.get(key) ?? 0) + 1);
      if (args.path === "./swapped.js") return { path: import.meta.dir + "/src/other.js" };
      if (calls.get(key) > 1) return { path: import.meta.dir + "/src/second.js" };
    });
  } });
  console.log("SAID IS", require("./src/root.js").told());
  console.log("SAID CALLS", [...calls].map(([key, count]) => key + "=" + count).sort().join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/h.js": `export { kind } from "./two.js";`,
    "src/leaf.js": `export {};`,
    "src/m.js": `export { kind } from "./m2.js";`,
    "src/m2.js": `import "./u.js";
export { kind } from "./h.js";`,
    "src/other.js": `export {};`,
    "src/root.js": `import "./u.js";
import { kind } from "./m.js";
export const told = () => kind;`,
    "src/second.js": `export const kind = "second";`,
    "src/swapped.js": `export {};`,
    "src/two.js": `export const kind = "two";`,
    "src/u.js": `import "./x.js";
import "./swapped.js";`,
    "src/x.js": `import "./leaf.js";`,
  },
  "one name under two types": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("one name under two types", () => {
  let calls = 0;
  plugin({ name: "counts", setup(build) {
    build.onResolve({ filter: /^\\.\\/data\\.json$/ }, () => { calls++; });
  } });
  console.log("SAID IS", require("./src/user.js").told());
  console.log("SAID CALLS", calls);
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/data.json": `{ "n": 1 }`,
    "src/user.js": `import typed from "./data.json" with { type: "json" };
import untyped from "./data.json";
export const told = () => typed.n + untyped.n;`,
  },
  "a load is given up at its first name": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a load that is given up at its first name", () => {
  const calls = [];
  plugin({ name: "first", setup(build) {
    build.onResolve({ filter: /^\\.\\/(boom|part-a)\\.js$/ }, args => {
      calls.push(args.path + "<" + args.importer.split("/").pop());
      if (args.path === "./boom.js") throw new RangeError("no");
      return { path: import.meta.dir + "/src/fake.js" };
    });
  } });
  try { require("./src/root.js"); console.log("SAID LOADED"); } catch (error) { console.log("SAID FAILED"); }
  console.log("SAID CALLS", calls.join(" "));
  plugin.clearAll();
  plugin({ name: "second", setup(build) {
    build.onResolve({ filter: /^\\.\\/part-b\\.js$/ }, () => ({ path: import.meta.dir + "/src/fake.js" }));
  } });
  console.log("SAID IS", require("./src/user-a.js").kind, require("./src/user-b.js").kind);
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/boom.js": `export {};`,
    "src/fake.js": `export const kind = "fake";`,
    "src/part-a.js": `export const kind = "real";`,
    "src/part-b.js": `export const kind = "real";`,
    "src/root.js": `import "./boom.js";
import "./user-a.js";
import "./user-b.js";`,
    "src/user-a.js": `export { kind } from "./part-a.js";`,
    "src/user-b.js": `export { kind } from "./part-b.js";`,
  },
  "a root above a file that left earlier": {
    "a.test.js": `import { plugin } from "bun";
import { test } from "bun:test";
test("a root above a file that left earlier", () => {
  const asked = [];
  const said = args => asked.push(args.path + "<" + args.importer.split("/").pop());
  plugin({ name: "first", setup(build) {
    build.onResolve({ filter: /^\\.\\/(swapped|trigger)\\.js$/ }, args => {
      said(args);
      if (args.path === "./swapped.js") return { path: import.meta.dir + "/src/other.js" };
      plugin({ name: "second", setup(later) {
        later.onResolve({ filter: /^\\.\\/part\\.js$/ }, asks => (said(asks), { path: import.meta.dir + "/src/fake.js" }));
      } });
    });
  } });
  require("./src/u.js");
  console.log("SAID IS", require("./src/root.js").told());
  console.log("SAID ASKED", [...new Set(asked)].sort().join(" "));
});`,
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/a.js": `import "./a2.js";`,
    "src/a2.js": `import "./trigger.js";`,
    "src/c.js": `export { kind } from "./part.js";`,
    "src/fake.js": `export const kind = "fake";`,
    "src/other.js": `export {};`,
    "src/part.js": `export const kind = "real";`,
    "src/root.js": `import "./a.js";
import { kind } from "./c.js";
import "./u.js";
export const told = () => kind;`,
    "src/swapped.js": `export {};`,
    "src/trigger.js": `export {};`,
    "src/u.js": `import "./swapped.js";`,
  },
};

const env = { ...bunEnv, NO_COLOR: "1", BUN_JSC_crashOnDisallowedVMEntry: "1" };
for (const [name, files] of Object.entries(projects)) {
  test(
    name,
    async () => {
      using dir = tempDir("plugins-are-asked-where-plain-bun-asks", files);
      const said = async (flags: string[]) => {
        const { stdout, exitCode } = await run([bunExe(), "test", ...flags, "./a.test.js"], String(dir), env);
        const lines = stdout.split("\n").filter(line => line.startsWith("SAID"));
        return { lines: lines.map(line => line.replace(/ ms \d+$/, "")), exitCode };
      };
      const plain = await said([]);
      expect(plain.lines.length).toBeGreaterThan(0);
      expect(await said(["--aot"])).toEqual(plain);
    },
    240_000,
  );
}
