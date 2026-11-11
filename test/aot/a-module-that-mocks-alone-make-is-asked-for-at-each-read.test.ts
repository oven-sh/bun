import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// THREE TEST FILES IN ONE REALM (`bun test`, no --isolate) mock the same module one after the other. The later factory wins, also for a file that imported the module behind an earlier mock.
// `bun test` takes what a mock has made out of the loader when the test file ends, with its importers: they load again and ask the mock that stands then. A compiled importer loads once.
// For a module of the program its reads look for the mock. A NAME WITH NO CODE BEHIND IT ("vscode", a package of types alone) is none of the program: the run kept what the loader had
// answered at the link, so the FIRST mock stayed for good, without a word, and the later factories never ran. A read from such a module now asks the run time, as require() does.
// Each shape is a project of its own, against plain `bun test`.
const shapes: Record<string, Record<string, string>> = {
  "a-kit-mocks-a-file-for-each-test-file": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("./real", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "real.ts": `export const who = () => "the file itself";
export const other = () => "other of the file";
`,
    "uses.ts": `import { who } from "./real";
export const use = () => who();
`,
  },
  "a-kit-mocks-a-package-for-each-test-file": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("pkg", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "node_modules/pkg/index.js": `export const who = () => "the package itself";
export const other = () => "other of the package";
`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module", "main": "index.js" }
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `import { who } from "pkg";
export const use = () => who();
`,
  },
  "a-kit-mocks-a-package-that-has-no-code": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("pkg", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "node_modules/pkg/index.d.ts": `export declare const who: () => string;
export declare const other: () => string;
`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "types": "index.d.ts" }
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `import { who } from "pkg";
export const use = () => who();
`,
  },
  "a-module-of-the-library": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("node:os", () => ({ hostname: () => "host of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `import { hostname } from "node:os";
export const use = () => hostname();
`,
  },
  "each-test-file-mocks-the-file-itself": {
    "a.test.ts": `import { mock, test } from "bun:test";
mock.module("./real", () => ({ who: () => "mock of a", other: () => "other of a" }));
const { use } = await import("./uses");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { mock, test } from "bun:test";
mock.module("./real", () => ({ who: () => "mock of b", other: () => "other of b" }));
const { use } = await import("./uses");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { mock, test } from "bun:test";
mock.module("./real", () => ({ who: () => "mock of c", other: () => "other of c" }));
const { use } = await import("./uses");
test("c", () => { console.log("SEEN c", use()); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "real.ts": `export const who = () => "the file itself";
export const other = () => "other of the file";
`,
    "uses.ts": `import { who } from "./real";
export const use = () => who();
`,
  },
  "each-test-file-mocks-the-package-itself": {
    "a.test.ts": `import { mock, test } from "bun:test";
mock.module("pkg", () => ({ who: () => "mock of a", other: () => "other of a" }));
const { use } = await import("./uses");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { mock, test } from "bun:test";
mock.module("pkg", () => ({ who: () => "mock of b", other: () => "other of b" }));
const { use } = await import("./uses");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { mock, test } from "bun:test";
mock.module("pkg", () => ({ who: () => "mock of c", other: () => "other of c" }));
const { use } = await import("./uses");
test("c", () => { console.log("SEEN c", use()); });
`,
    "node_modules/pkg/index.js": `export const who = () => "the package itself";
export const other = () => "other of the package";
`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module", "main": "index.js" }
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `import { who } from "pkg";
export const use = () => who();
`,
  },
  "no-code-a-class-is-made": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("vscode", () => ({ Thing: class { who() { return "thing of " + name; } } }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import { Thing } from "vscode";
export const use = () => new Thing().who();
`,
  },
  "no-code-a-file-exports-all-again": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "again.ts": `// @ts-ignore
export * from "vscode";
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("vscode", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import { who } from "./again";
export const use = () => who();
`,
  },
  "no-code-a-file-exports-the-name-again": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "again.ts": `// @ts-ignore
export { who } from "vscode";
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("vscode", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `import { who } from "./again";
export const use = () => who();
`,
  },
  "no-code-a-name-with-a-colon": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("virtual:config", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import { who } from "virtual:config";
export const use = () => who();
`,
  },
  "no-code-a-test-file-mocks-over-the-preload": {
    "a.test.ts": `import { test } from "bun:test";
import { use } from "./uses";
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { mock, test } from "bun:test";
import { use } from "./uses";
test("b", () => { mock.module("vscode", () => ({ who: () => "mock of b" })); console.log("SEEN b", use()); });
`,
    "bunfig.toml": `[test]
preload = ["./setup.ts"]
`,
    "c.test.ts": `import { test } from "bun:test";
import { use } from "./uses";
test("c", () => { console.log("SEEN c", use()); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "setup.ts": `import { mock } from "bun:test";
mock.module("vscode", () => ({ who: () => "mock of the preload" }));
`,
    "uses.ts": `// @ts-ignore
import { who } from "vscode";
export const use = () => who();
`,
  },
  "no-code-a-value-that-is-no-function": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("vscode", () => ({ version: "version of " + name, list: [name] }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import { version, list } from "vscode";
export const use = () => version + " | " + list.join();
`,
  },
  "no-code-default-and-names": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("vscode", () => ({ default: { inner: "default of " + name }, who: () => "mock of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import all, { who } from "vscode";
export const use = () => all.inner + " | " + who();
`,
  },
  "no-code-nothing-on-disk-at-all": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("vscode", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import { who } from "vscode";
export const use = () => who();
`,
  },
  "no-code-one-preload-mocks-it-once": {
    "a.test.ts": `import { test } from "bun:test";
import { use } from "./uses";
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { use } from "./uses";
test("b", () => { console.log("SEEN b", use()); });
`,
    "bunfig.toml": `[test]
preload = ["./setup.ts"]
`,
    "c.test.ts": `import { test } from "bun:test";
import { use } from "./uses";
test("c", () => { console.log("SEEN c", use()); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "setup.ts": `import { mock } from "bun:test";
mock.module("vscode", () => ({ who: () => "mock of the preload" }));
`,
    "uses.ts": `// @ts-ignore
import { who } from "vscode";
export const use = () => who();
`,
  },
  "no-code-the-default-export": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("vscode", () => ({ default: () => "default of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import who from "vscode";
export const use = () => who();
`,
  },
  "no-code-the-mock-is-laid-inside-a-test": {
    "a.test.ts": `import { mock, test } from "bun:test";
test("a", async () => {
  mock.module("vscode", () => ({ who: () => "mock of a" }));
  const { use } = await import("./uses");
  console.log("SEEN a", use());
  mock.module("vscode", () => ({ who: () => "second mock of a" }));
  console.log("SEEN a", use());
});
`,
    "b.test.ts": `import { mock, test } from "bun:test";
test("b", async () => {
  mock.module("vscode", () => ({ who: () => "mock of b" }));
  const { use } = await import("./uses");
  console.log("SEEN b", use());
  mock.module("vscode", () => ({ who: () => "second mock of b" }));
  console.log("SEEN b", use());
});
`,
    "c.test.ts": `import { mock, test } from "bun:test";
test("c", async () => {
  mock.module("vscode", () => ({ who: () => "mock of c" }));
  const { use } = await import("./uses");
  console.log("SEEN c", use());
  mock.module("vscode", () => ({ who: () => "second mock of c" }));
  console.log("SEEN c", use());
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import { who } from "vscode";
export const use = () => who();
`,
  },
  "no-code-the-namespace": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("vscode", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import * as all from "vscode";
export const use = () => [all.who(), Object.keys(all).sort().join(), "who" in all, "none" in all, typeof all, (all as any).none].join(" | ");
`,
  },
  "no-code-the-namespace-goes-somewhere": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("vscode", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `// @ts-ignore
import * as all from "vscode";
const call = (from: any) => from.who();
export const use = () => call(all);
`,
  },
  "the-user-holds-the-namespace": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("pkg", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "node_modules/pkg/index.js": `export const who = () => "the package itself";
export const other = () => "other of the package";
`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module", "main": "index.js" }
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `import * as pkg from "pkg";
export const use = () => pkg.who() + " | " + pkg.other();
`,
  },
  "the-user-requires-the-package": {
    "a.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("a");
test("a", () => { console.log("SEEN a", use()); });
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("b");
test("b", () => { console.log("SEEN b", use()); });
`,
    "c.test.ts": `import { test } from "bun:test";
import { load } from "./kit";
const use = await load("c");
test("c", () => { console.log("SEEN c", use()); });
`,
    "kit.ts": `import { mock } from "bun:test";
export async function load(name: string) {
  mock.module("pkg", () => ({ who: () => "mock of " + name, other: () => "other of " + name }));
  const { use } = await import("./uses");
  return use;
}
`,
    "node_modules/pkg/index.js": `export const who = () => "the package itself";
export const other = () => "other of the package";
`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module", "main": "index.js" }
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "uses.ts": `export const use = () => require("pkg").who();
`,
  },
};

for (const [name, files] of Object.entries(shapes)) {
  test.concurrent(
    `one module mocked by one test file after another: ${name}`,
    async () => {
      using dir = tempDir("aot-mocked-in-turn", files);
      const seenWith = async (...flags: string[]) => {
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
        return {
          lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
          errors: stderr.split("\n").filter(line => /^\(fail\)|^[A-Za-z]*[Ee]rror/.test(line)),
          exitCode,
        };
      };
      const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
      expect(plain.lines.length).toBeGreaterThan(2);
      expect(plain.exitCode).toBe(0);
      expect(compiled).toEqual(plain);
    },
    120_000,
  );
}
