import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { builtinModules } from "node:module";
import { run } from "./harness/run";
import { test } from "./supported";

// `get EOL()` of node:os, `get promises()` of node:fs, `get inspect()` of node:util: the host reads such an export when something first asks for it.
const modulesWithGetters = builtinModules
  .filter(module => !module.startsWith("_") && module !== "sys" && module !== "repl")
  .map(module => {
    const descriptors = Object.entries(Object.getOwnPropertyDescriptors(require(module)));
    const getters = descriptors.filter(([name, it]) => it.get && it.enumerable && /^[A-Za-z$][\w$]*$/.test(name));
    return { module, names: getters.map(([name]) => name) };
  })
  .filter(({ names }) => names.length > 0);

const kinds = (object: string, names: string[]) => names.map(name => `typeof ${object}.${name}`).join(", ");

function mocks(module: string, names: string[], after = "") {
  return `
    import { afterAll, mock, test } from "bun:test";
    import { ${names.join(", ")} } from "${module}";
    ${after}
    test("mocks", () => {
      mock.module("${module}", () => ({ ${names.map(name => `${name}: "mocked"`).join(", ")} }));
      console.log("| ${module} mocked:", ${names.join(", ")});
    });`;
}

function reads(title: string, declarations: string, values: string) {
  return `
    import { test } from "bun:test";
    ${declarations}
    test("reads", async () => {
      console.log("| ${title}:", ${values});
    });`;
}

function everyModule() {
  const files: Record<string, string> = { "package.json": `{ "name": "p", "type": "module" }` };
  modulesWithGetters.forEach(({ module, names }, index) => {
    const folder = `m${String(index).padStart(2, "0")}`;
    const namespace = reads(`${module} off the namespace`, `import * as all from "${module}";`, kinds("all", names));
    files[`${folder}/1-reads.test.js`] = namespace;
    files[`${folder}/2-mocks.test.js`] = mocks(module, names);
    files[`${folder}/3-reads.test.js`] = namespace;
    files[`${folder}/4-reads-by-name.test.js`] = reads(
      `${module} by name`,
      `import { ${names.join(", ")} } from "${module}";`,
      names.map(name => `typeof ${name}`).join(", "),
    );
    files[`${folder}/5-reads-the-object.test.js`] = reads(
      `${module} off the object`,
      `import whole from "${module}";\nconst required = require("${module}");`,
      `${kinds("whole", names)}, ${kinds("required", names)}, ${kinds(`(await import("${module}"))`, names)}`,
    );
  });
  return files;
}

function everyWayToTheNamespace() {
  const names = ["EOL", "tmpdir"];
  const both = (object: string) => `JSON.stringify(${object}.EOL), typeof ${object}.tmpdir()`;
  return {
    "package.json": `{ "name": "p", "type": "module" }`,
    "hands-the-namespace-on.js": `export * as os from "node:os";`,
    "hands-every-name-on.js": `export * from "node:os";`,
    "helper.js": `import * as os from "node:os";\nexport const read = () => [os.EOL, typeof os.tmpdir()];`,
    "0.test.js": reads("before any mock", `import * as os from "node:os";`, both("os")),
    "a-mocks.test.js": mocks("node:os", names),
    "b-mocks-and-restores.test.js": mocks("node:os", names, `afterAll(() => mock.restore());`),
    "c-mocks-and-puts-back.test.js": mocks(
      "node:os",
      names,
      `const real = { ...require("node:os") };\nafterAll(() => mock.module("node:os", () => real));`,
    ),
    "d-mocks-another-name.test.js": `
      import { mock, test } from "bun:test";
      import { EOL } from "node:os";
      test("mocks", () => {
        mock.module("node:os", () => ({ devNull: "mocked" }));
        console.log("| another name is mocked:", JSON.stringify(EOL));
      });`,
    "e.test.js": reads("import * as", `import * as os from "node:os";`, both("os")),
    "f.test.js": reads("export * as", `import { os } from "./hands-the-namespace-on.js";`, both("os")),
    "g.test.js": reads("export *", `import * as os from "./hands-every-name-on.js";`, both("os")),
    "h.test.js": reads("a file that the test imports", `import { read } from "./helper.js";`, "read()"),
    "i.test.js": reads("a file that the test imports later", "", `(await import("./helper.js")).read()`),
    "j.test.js": reads(
      "require() of a module",
      `const handed = require("./hands-the-namespace-on.js");`,
      both("handed.os"),
    ),
    "k.test.js": reads(
      "while the file loads",
      `import * as os from "node:os";\nconst early = [os.EOL, typeof os.tmpdir];`,
      "early",
    ),
    "l.test.js": reads(
      "a name that no mock of the run has",
      `import * as os from "node:os";`,
      "os.devNull, typeof os.hostname",
    ),
    "m.test.js": `
      import { mock, test } from "bun:test";
      test("reads", async () => {
        mock.module("node:os", () => ({ EOL: "mocked" }));
        console.log("| a file that loads behind the mock:", (await import("./helper-behind-the-mock.js")).read());
      });`,
    "helper-behind-the-mock.js": `import * as os from "node:os";\nexport const read = () => [os.EOL, typeof os.tmpdir, typeof os.hostname];`,
  };
}

async function report(directory: string, flags: string[], words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], directory, env);
  const printed = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("| "));
  const counts = stderr.match(/^ *\d+ (pass|fail)$/gm)?.map(line => line.trim());
  if (exitCode !== 0) console.error(stderr);
  return { printed: printed.sort(), counts, exitCode };
}

function runsAsPlain(title: string, files: () => Record<string, string>, flags: string[], words?: string) {
  test(title, async () => {
    using directory = tempDir("a-getter-of-a-mocked-built-in-module", files());
    const plain = await report(String(directory), flags);
    expect(plain.exitCode).toBe(0);
    expect(plain.printed).not.toBeEmpty();
    expect(await report(String(directory), ["--aot", ...flags], words)).toEqual(plain);
  });
}

test("built-in modules export getters", () => {
  expect(modulesWithGetters.find(({ module }) => module === "os")?.names).toContain("EOL");
});

runsAsPlain("every way to the namespace, each test file in a realm of its own", everyWayToTheNamespace, ["--isolate"]);
runsAsPlain("every way to the namespace, in two processes", everyWayToTheNamespace, ["--isolate", "--parallel=2"]);
runsAsPlain("every way to the namespace, all test files in one realm", everyWayToTheNamespace, []);
runsAsPlain("every way to the namespace, over two layers", everyWayToTheNamespace, ["--isolate"], "TestRunLayers:2");
runsAsPlain("every built-in module, each test file in a realm of its own", everyModule, ["--isolate"]);
runsAsPlain("every built-in module, all test files in one realm", everyModule, []);
