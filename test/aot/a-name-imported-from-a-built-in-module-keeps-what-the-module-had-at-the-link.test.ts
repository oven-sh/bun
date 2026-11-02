// `import { createRequire } from "node:module"` binds what the module exports when the importing file is linked. A test that stores
// to the object of the module afterwards, `Module.createRequire = fake`, changes what `Module.createRequire` reads and not the import.
// node:module, node:process and bun give an export its value only when a file that binds the name is linked, so these three show it.
import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

const project = casesOfOneRun("a-name-imported-from-a-built-in-module-keeps-what-the-module-had-at-the-link", {
  "package.json": `{ "name": "p", "type": "module" }`,
});

type Case = {
  /** How the test file gets the object of the module. */
  object: string;
  /** The members that `stores` replaces. */
  members: string[];
  /** Each puts something there that `read()` would tell from the real member. */
  stores: string;
  files: Record<string, string>;
  /** What `read()` of uses.mjs answers behind the stores, and again when the members are put back. */
  expected: string;
};

function keepsWhatTheModuleHad(title: string, { object, stores, members, files, expected }: Case) {
  const id = project.add(
    name => `
      import { test, spyOn } from "bun:test";
      ${object}
      import { read } from "./uses.mjs";
      ${sayOf(name)}
      test("${name}", () => {
        const real = { ${members.map(member => `${member}: object.${member}`).join(", ")} };
        ${stores}
        say("stored:", read());
        say("members:", ${members.map(member => `object.${member} === real.${member}`).join(", ")});
        ${members.map(member => `object.${member} = real.${member};`).join(" ")}
        say("put back:", read());
      });`,
    files,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(id)!;
    expect(plain).toEqual({
      result: "pass",
      printed: `stored: ${expected}\nmembers: ${members.map(() => "false").join(" ")}\nput back: ${expected}\n`,
    });
    const asOneProgram = (await project.ran(["--aot"], "TestRunLayers:0")).get(id);
    const inLayers = (await project.ran(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).get(id);
    expect({ asOneProgram, inLayers }).toEqual({ asOneProgram: plain, inLayers: plain });
  });
}

const ofNodeModule = {
  object: `import object from "node:module";`,
  members: ["createRequire", "isBuiltin", "builtinModules", "wrap", "findSourceMap"],
  stores: `
    object.createRequire = () => 1;
    object.isBuiltin = () => "fake";
    object.builtinModules = 5;
    object.wrap = () => 2;
    object.findSourceMap = () => 3;`,
  expected: "function true object string undefined",
};
const readNodeModule = (from = "") => `
  export const read = () =>
    [
      typeof ${from}createRequire(import.meta.url),
      ${from}isBuiltin("fs"),
      typeof ${from}builtinModules,
      typeof ${from}wrap("1"),
      typeof ${from}findSourceMap("x"),
    ].join(" ");`;
const namesOfNodeModule = "{ createRequire, isBuiltin, builtinModules, wrap, findSourceMap }";

keepsWhatTheModuleHad("names of node:module that are first used behind the stores", {
  ...ofNodeModule,
  files: { "uses.mjs": `import ${namesOfNodeModule} from "node:module";${readNodeModule()}` },
});

keepsWhatTheModuleHad("names of node:module behind spies", {
  ...ofNodeModule,
  members: ["createRequire", "isBuiltin", "wrap"],
  stores: `
    spyOn(object, "createRequire").mockImplementation(() => 1);
    spyOn(object, "isBuiltin").mockImplementation(() => "fake");
    spyOn(object, "wrap").mockImplementation(() => 2);`,
  files: { "uses.mjs": `import ${namesOfNodeModule} from "node:module";${readNodeModule()}` },
});

keepsWhatTheModuleHad("the namespace object of node:module in a file that binds the names too", {
  ...ofNodeModule,
  files: {
    "uses.mjs": `
      import * as all from "node:module";
      import ${namesOfNodeModule} from "node:module";
      export const bound = () => [createRequire, isBuiltin, builtinModules, wrap, findSourceMap];
      ${readNodeModule("all.")}`,
  },
});

// No link binds a name here, so each gets its value when the namespace object is first asked for it, and keeps that.
keepsWhatTheModuleHad("the namespace object of node:module where no file binds a name", {
  ...ofNodeModule,
  files: { "uses.mjs": `import * as all from "node:module";${readNodeModule("all.")}` },
  expected: "number fake number number number",
});

keepsWhatTheModuleHad("names of node:module that another file hands on", {
  ...ofNodeModule,
  files: {
    "middle.mjs": `export ${namesOfNodeModule} from "node:module";`,
    "uses.mjs": `import ${namesOfNodeModule} from "./middle.mjs";${readNodeModule()}`,
  },
});

keepsWhatTheModuleHad("names of node:module that come through export *", {
  ...ofNodeModule,
  files: {
    "star.mjs": `export * from "node:module";`,
    "stars.mjs": `export * from "./star.mjs"; export const own = 1;`,
    "uses.mjs": `import ${namesOfNodeModule} from "./stars.mjs";${readNodeModule()}`,
  },
});

keepsWhatTheModuleHad("names of node:module in a package", {
  ...ofNodeModule,
  files: {
    "node_modules/reader/package.json": `{ "name": "reader", "type": "module", "main": "index.js" }`,
    "node_modules/reader/index.js": `import ${namesOfNodeModule} from "node:module";${readNodeModule()}`,
    "uses.mjs": `export { read } from "reader";`,
  },
});

keepsWhatTheModuleHad("names of node:process", {
  object: `import object from "node:process";`,
  members: ["cwd", "uptime", "argv0", "execArgv", "emitWarning"],
  stores: `
    object.cwd = () => 1;
    object.uptime = () => "fake";
    object.argv0 = 5;
    object.execArgv = 5;
    object.emitWarning = 2;`,
  files: {
    "uses.mjs": `
      import { cwd, uptime, argv0, execArgv, emitWarning } from "node:process";
      export const read = () =>
        [typeof cwd(), typeof uptime(), typeof argv0, typeof execArgv, typeof emitWarning].join(" ");`,
  },
  expected: "string number string object function",
});

keepsWhatTheModuleHad("names of bun", {
  object: `const object = Bun;`,
  members: ["which", "nanoseconds", "inspect"],
  stores: `
    object.which = () => 1;
    object.nanoseconds = () => "fake";
    object.inspect = () => 2;`,
  files: {
    "uses.mjs": `
      import { which, nanoseconds, inspect } from "bun";
      export const read = () => [String(which("no-such-program-anywhere")), typeof nanoseconds(), inspect(1)].join(" ");`,
  },
  expected: "null number 1",
});
