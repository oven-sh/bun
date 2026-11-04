import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `spyOn(between, "who")`, where between.ts imports `who` from origin.ts and exports it again.
// Where a Worker starts from between.ts the file is an entry point, and where the files of the run may load again the import statements of an entry point are left to the loader:
// the table has the name and who asks, not the file. The spy walked from the export to that name, found no table there and was refused:
// "the build didn't see a test spy on it", though the build had seen it. It takes three test files to make the shape: one starts the Worker, one gives the reason, one spies.
// Each shape is a project of its own, against plain `bun test`.
const shapes: Record<string, Record<string, string>> = {
  "export-from-a-text-goes-to-a-loader-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./support/load";
test("b", async () => { if (process.env.NOBODY_SETS_THIS) await load(import.meta.dir + "/src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `export { who } from "./origin";
export const own = () => 1;
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
    "support/load.ts": `export const load = (path: string) => import(path);
`,
  },
  "export-from-a-worker-starts-from-it": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `export { who } from "./origin";
export const own = () => 1;
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-from-a-worker-starts-from-it-and-a-key-nobody-reads-is-taken-out": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) delete require.cache[process.env.NOBODY_SETS_THIS];
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `export { who } from "./origin";
export const own = () => 1;
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-from-a-worker-starts-from-it-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `export { who } from "./origin";
export const own = () => 1;
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-from-a-worker-starts-from-its-path": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `export { who } from "./origin";
export const own = () => 1;
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-from-a-worker-starts-from-its-path-and-a-key-nobody-reads-is-taken-out": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) delete require.cache[process.env.NOBODY_SETS_THIS];
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `export { who } from "./origin";
export const own = () => 1;
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-from-a-worker-starts-from-its-path-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `export { who } from "./origin";
export const own = () => 1;
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-from-alone": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `export { who } from "./origin";
export const own = () => 1;
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-from-found-by-a-name-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
const find = (name: string) => import(\`./src/\${name}.ts\`);
void find;
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `export { who } from "./origin";
export const own = () => 1;
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-under-another-name-a-text-goes-to-a-loader-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./support/load";
test("b", async () => { if (process.env.NOBODY_SETS_THIS) await load(import.meta.dir + "/src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
    "support/load.ts": `export const load = (path: string) => import(path);
`,
  },
  "export-under-another-name-a-worker-starts-from-it": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-under-another-name-a-worker-starts-from-it-and-a-key-nobody-reads-is-taken-out": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) delete require.cache[process.env.NOBODY_SETS_THIS];
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-under-another-name-a-worker-starts-from-it-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-under-another-name-a-worker-starts-from-its-path": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-under-another-name-a-worker-starts-from-its-path-and-a-key-nobody-reads-is-taken-out": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) delete require.cache[process.env.NOBODY_SETS_THIS];
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-under-another-name-a-worker-starts-from-its-path-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-under-another-name-alone": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "export-under-another-name-found-by-a-name-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
const find = (name: string) => import(\`./src/\${name}.ts\`);
void find;
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "import-then-export-a-text-goes-to-a-loader-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
import { load } from "./support/load";
test("b", async () => { if (process.env.NOBODY_SETS_THIS) await load(import.meta.dir + "/src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who } from "./origin";
export { who };
export const own = () => who();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
    "support/load.ts": `export const load = (path: string) => import(path);
`,
  },
  "import-then-export-a-worker-starts-from-it": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who } from "./origin";
export { who };
export const own = () => who();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "import-then-export-a-worker-starts-from-it-and-a-key-nobody-reads-is-taken-out": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) delete require.cache[process.env.NOBODY_SETS_THIS];
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who } from "./origin";
export { who };
export const own = () => who();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "import-then-export-a-worker-starts-from-it-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who } from "./origin";
export { who };
export const own = () => who();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "import-then-export-a-worker-starts-from-its-path": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who } from "./origin";
export { who };
export const own = () => who();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "import-then-export-a-worker-starts-from-its-path-and-a-key-nobody-reads-is-taken-out": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) delete require.cache[process.env.NOBODY_SETS_THIS];
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who } from "./origin";
export { who };
export const own = () => who();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "import-then-export-a-worker-starts-from-its-path-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "b.test.ts": `import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who } from "./origin";
export { who };
export const own = () => who();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "import-then-export-alone": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who } from "./origin";
export { who };
export const own = () => who();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
  "import-then-export-found-by-a-name-and-a-plugin-is-named": {
    "a.test.ts": `import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
const find = (name: string) => import(\`./src/\${name}.ts\`);
void find;
if (process.env.NOBODY_SETS_THIS) Bun.plugin({ name: "p", setup() {} });
test("a", () => {
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/between.ts": `import { who } from "./origin";
export { who };
export const own = () => who();
`,
    "src/origin.ts": `export const who = () => "real";
export const more = () => "more";
`,
    "src/reader.ts": `import { who } from "./origin";
export const read = () => who();
`,
  },
};

for (const [name, files] of Object.entries(shapes)) {
  test.concurrent(`a spy on a name that a file exports again: ${name}`, async () => {
    using dir = tempDir("aot-spy-on-a-name-exported-again", files);
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      return {
        lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
        errors: stderr.split("\n").filter(line => /^\(fail\)|^[A-Za-z]*[Ee]rror/.test(line)),
        exitCode,
      };
    };
    const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
    expect(plain.lines.slice(0, 2)).toEqual(["SEEN spied spied " + plain.lines[0].split(" ")[3], "SEEN real real " + plain.lines[1].split(" ")[3]]);
    expect(plain.exitCode).toBe(0);
    expect(compiled).toEqual(plain);
  }, 120_000);
}
