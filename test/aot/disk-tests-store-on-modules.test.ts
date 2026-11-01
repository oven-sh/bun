import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test file that the host runs from disk changes a member on the object of a module of Bun's own. Compiled code of the project reads that member
// by a named import, by a namespace, by require() and off the default import, before the change and behind it, as under plain `bun test`.
const readers = (module: string, member: string, operands: string) => `
  import { ${member} as named } from "${module}";
  import * as star from "${module}";
  import whole from "${module}";
  const tell = (act: () => unknown): string => { try { return String(act()); } catch (error) { return (error as Error).constructor.name; } };
  export const read = (): string => [
    tell(() => (named as any)(${operands})),
    tell(() => (star as any).${member}(${operands})),
    tell(() => require("${module}").${member}(${operands})),
    tell(() => (whole as any).${member}(${operands})),
    typeof require("${module}").${member},
  ].join(" ");`;

type Loads = "first" | "late";
type Change = [module: string, member: string, operands: string, change: string];
const nameOf = (title: string, loads: Loads) => `${title.replace(/\W+/g, "-")}-${loads}`;

// Each case has a module of Bun's own to itself, readers of its own and a test file of its own, which runs in a realm of its own.
const project = (cases: [title: string, change: Change, loads: Loads][]) => {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "type": "module" }`,
    "node_modules/pkg/index.js": `export const change = (object, key, value) => { object[key] = value; };`,
  };
  for (const [title, [module, member, operands, change], loads] of cases) {
    const name = nameOf(title, loads);
    files[`src/${name}.ts`] = readers(module, member, operands);
    files[`tests/${name}.test.ts`] = `
    import { test } from "bun:test";
    import { change } from "pkg";
    import * as whole from "${module}";
    ${loads === "first" ? `import { read } from "../src/${name}";` : ""}
    const mine = () => "mine";
    test("t", async () => {
      ${loads === "first" ? `console.log("| ${name} before", read());` : ""}
      ${change};
      ${loads === "late" ? `const { read } = await import("../src/${name}");` : ""}
      console.log("| ${name} behind", read());
    });`;
  }
  return files;
};

const changes: Record<string, Change> = {
  "a store on bun:test": ["bun:test", "spyOn", `{ m() {} }, "m"`, `require("bun:test").spyOn = mine`],
  "Object.assign": ["node:buffer", "atob", `"YQ=="`, `Object.assign(require("node:buffer"), { atob: mine })`],
  "delete": ["node:path", "join", `"a", "b"`, `delete require("node:path").join`],
  "a store through the default export": ["node:fs", "existsSync", `"/"`, `(whole as any).default.existsSync = mine`],
  "a package stores": ["node:os", "platform", ``, `change(require("node:os"), "platform", mine)`],
  "evaluated text stores": [
    "node:util",
    "format",
    `"%s", 1`,
    `(0, eval)('process.getBuiltinModule("node:util").format = () => "mine"')`,
  ],
  "a store on a native module": [
    "node:util/types",
    "isDate",
    `1`,
    `process.getBuiltinModule("node:util/types").isDate = mine`,
  ],
};

const report = async (directory: string, flags: string[], env: Record<string, string | undefined>) => {
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags, "./tests"], directory, env);
  return {
    exitCode,
    printed: stdout
      .split("\n")
      .filter(line => line.startsWith("| "))
      .sort(),
  };
};
const fromDisk = { ...bunEnv, BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" };
const all = Object.entries(changes).flatMap(([title, change]) =>
  (["first", "late"] as const).map(loads => [title, change, loads] as [string, Change, Loads]),
);
const failsAtLink = ([title, , loads]: [string, Change, Loads]) => title === "delete" && loads === "late";

// A run with the test files from disk compiles all of Bun's own library, whatever the project: one run serves every case.
test("compiled readers see what a test file from disk changes on a module of Bun's own", async () => {
  const cases = all.filter(it => !failsAtLink(it));
  using directory = tempDir("disk-tests-store-on-modules", project(cases));
  const plain = await report(String(directory), [], bunEnv);
  expect(plain).toMatchObject({
    exitCode: 0,
    printed: { length: cases.length + cases.filter(it => it[2] === "first").length },
  });
  expect(plain.printed.filter(line => line.includes(" behind ") && !line.includes("mine"))).toEqual([
    expect.stringContaining("| delete-first behind "),
  ]);
  expect(await report(String(directory), ["--aot"], fromDisk)).toEqual(plain);
}, 240_000);

test("a name that was deleted before the readers are loaded", async () => {
  using directory = tempDir("disk-tests-store-on-modules", project(all.filter(failsAtLink)));
  // It is missing at their link: the run fails.
  const plain = await report(String(directory), [], bunEnv);
  expect(plain).toEqual({ exitCode: 1, printed: [] });
  // TODO(bun): the compiled readers are linked all the same and read undefined. It goes red once the link fails as in plain.
  expect(await report(String(directory), ["--aot"], fromDisk)).not.toEqual(plain);
}, 120_000);
