// Mocks of modules, as deeds for the worlds of write-loads.ts. A test run holds a file and what stands in for it side by side: who asks for the file gets the one or the other by when the mock was
// laid, by whom, where, and by what its factory gives. A compiler that answers a load in place has decided before any of that ran.
//
// The tables do not know of each other: who lays a mock, with which factory, and where the call stands: in the test, at the top of the test file, in a preload of the project, or in a file of the graph
// that the test loads. Beside them: who takes a mock away, who asks for the real file or for the mock by name, a file that imports the mocked one by a statement, and what a preload held before the test began.
//
// No call that lays a mock is awaited: `waits-a-turn` of write-loads.ts stands behind it in the rows that want it settled.
//
// Only a test run has them.
import type { Deed } from "./write-loads.ts";

/** What stands behind the id in a call that lays a mock. `tag` says in the answers which mock it was. */
const factories: Record<string, (tag: string) => string> = {
  "an-object": tag => `, () => ({ a: "${tag}" })`,
  "more-names": tag => `, () => ({ a: "${tag}", added: "${tag}", default: "${tag}" })`,
  "a-late-object": tag => `, async () => {\n    await 0;\n    return { a: "${tag}" };\n  }`,
  "over-the-real-file": tag => `, async real => ({ ...(await real()), a: "${tag}" })`,
  "nothing": () => ``,
  "a-throw": tag => `, () => {\n    throw new RangeError("made up ${tag}");\n  }`,
};

const undoes = (file: string) => `undo.push(() => vi.doUnmock("./${file}"));`;

function* layers(): Generator<Deed> {
  for (const [made, factory] of Object.entries(factories)) {
    for (const call of ["mock.module", "vi.doMock", "jest.doMock"]) {
      // mock.module() wants a factory.
      if (call === "mock.module" && made === "nothing") continue;
      const name = `mocks-by-${call.replace(".", "-")}-with-${made}`;
      yield {
        name,
        inTestRunsAlone: true,
        body: (file, at) =>
          `${undoes(file)}\n  ${call}("./${file}"${factory(`${at} in the test`)});\n  console.log("${at} ${name}");`,
      };
    }
    for (const call of ["vi.mock", "jest.mock", "mock.module"]) {
      if (call === "mock.module" && made === "nothing") continue;
      const name = `mocked-at-the-top-by-${call.replace(".", "-")}-with-${made}`;
      yield {
        name,
        inTestRunsAlone: true,
        head: (file, at) => `${call}("./${file}"${factory(`${at} at the top`)});`,
        body: (file, at) => `${undoes(file)}\n  console.log("${at} ${name}");`,
      };
    }
    for (const call of ["vi.mock", "mock.module"]) {
      if (call === "mock.module" && made === "nothing") continue;
      const name = `mocked-in-a-preload-by-${call.replace(".", "-")}-with-${made}`;
      yield {
        name,
        inTestRunsAlone: true,
        preload: (path, at) => `${call}("${path}"${factory(`${at} in the preload`)});`,
        body: (_, at) => `console.log("${at} ${name}");`,
      };
      // The file is loaded under the mock before the test file begins.
      yield {
        name: name.replace("mocked-in", "mocked-and-loaded-in"),
        inTestRunsAlone: true,
        preload: (path, at) =>
          `${call}("${path}"${factory(`${at} in the preload`)});\nawait import("${path}").catch(() => {});`,
        body: (_, at) => `console.log("${at} ${name.replace("mocked-in", "mocked-and-loaded-in")}");`,
      };
    }
    {
      const name = `loads-a-file-that-mocks-with-${made}`;
      yield {
        name,
        inTestRunsAlone: true,
        files: (file, at) => ({
          [`lays${at}.mjs`]: `import { vi } from "bun:test";\nvi.doMock("./${file}"${factory(`${at} in the graph`)});\n`,
        }),
        body: (file, at) => `${undoes(file)}\n  await import("./lays${at}.mjs");\n  console.log("${at} ${name}");`,
      };
    }
  }
}

// prettier-ignore
const others: Deed[] = [
  { name: "unmocks-by-vi-doUnmock", inTestRunsAlone: true, body: (file, at) => `vi.doUnmock("./${file}");\n  console.log("${at} unmocks-by-vi-doUnmock");` },
  { name: "unmocks-by-jest-dontMock", inTestRunsAlone: true, body: (file, at) => `jest.dontMock("./${file}");\n  console.log("${at} unmocks-by-jest-dontMock");` },
  { name: "unmocked-at-the-top", inTestRunsAlone: true, head: file => `vi.unmock("./${file}");`, body: (_, at) => `console.log("${at} unmocked-at-the-top");` },
  { name: "restores-the-mocks", inTestRunsAlone: true, body: (_, at) => `mock.restore();\n  console.log("${at} restores-the-mocks");` },
  { name: "restores-all-mocks", inTestRunsAlone: true, body: (_, at) => `vi.restoreAllMocks();\n  console.log("${at} restores-all-mocks");` },
  { name: "resets-the-modules", inTestRunsAlone: true, body: (_, at) => `vi.resetModules();\n  console.log("${at} resets-the-modules");` },
  { name: "imports-the-real-file", inTestRunsAlone: true, body: (file, at) => `say("${at} imports-the-real-file", await vi.importActual("./${file}"));` },
  { name: "imports-the-mock", inTestRunsAlone: true, body: (file, at) => `say("${at} imports-the-mock", await vi.importMock("./${file}"));` },
  { name: "requires-the-real-file", inTestRunsAlone: true, body: (file, at) => `say("${at} requires-the-real-file", jest.requireActual("./${file}"));` },
  { name: "requires-the-mock", inTestRunsAlone: true, body: (file, at) => `say("${at} requires-the-mock", jest.requireMock("./${file}"));` },
  {
    name: "imports-a-file-that-imports-it",
    inTestRunsAlone: true,
    files: (file, at) => ({ [`user${at}.mjs`]: `import * as all from "./${file}";\nexport const a = all.a;\nexport const keys = Object.keys(all).join();\nexport const later = () => all.a;\n` }),
    body: (_, at) => `const user${at} = await import("./user${at}.mjs");\n  console.log("${at} imports-a-file-that-imports-it", String(user${at}.a), user${at}.keys, String(user${at}.later()));`,
  },
  {
    name: "requires-a-file-that-requires-it",
    inTestRunsAlone: true,
    files: (file, at) => ({ [`user${at}.cjs`]: `const all = require("./${file}");\nexports.a = all?.a;\nexports.keys = all === null || typeof all !== "object" ? typeof all : Object.keys(all).join();\nexports.later = () => all?.a;\n` }),
    body: (_, at) => `const user${at} = require("./user${at}.cjs");\n  console.log("${at} requires-a-file-that-requires-it", String(user${at}.a), user${at}.keys, String(user${at}.later()));`,
  },
  {
    name: "imports-in-a-preload-and-asks-now",
    inTestRunsAlone: true,
    preload: path => `(globalThis.heldByThePreload ??= {})[require.resolve("${path}")] = await import("${path}").catch(error => "threw " + error?.name);`,
    body: (file, at) => `say("${at} imports-in-a-preload-and-asks-now", globalThis.heldByThePreload?.[require.resolve("./${file}")]);`,
  },
  {
    name: "requires-in-a-preload-and-asks-now",
    inTestRunsAlone: true,
    preload: path => `try {\n  (globalThis.requiredByThePreload ??= {})[require.resolve("${path}")] = require("${path}");\n} catch (error) {\n  globalThis.requiredByThePreload[require.resolve("${path}")] = "threw " + error?.name;\n}`,
    body: (file, at) => `say("${at} requires-in-a-preload-and-asks-now", globalThis.requiredByThePreload?.[require.resolve("./${file}")]);`,
  },
];

export const deedsOfMocks: Deed[] = [...layers(), ...others];
