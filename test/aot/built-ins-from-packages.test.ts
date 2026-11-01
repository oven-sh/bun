// A package hands a built-in on under a name of its own, `export const File = globalThis.File`, and a test writes on it: `File.prototype.text = stub`.
// As one program the build follows the export. Over layers the run has to know what its tests write on built-ins before the first build, from a look at the
// files of the tests, and that look read no package: "TypeError: Cannot assign to Blob.prototype.planted because built-in objects are read-only in compiled code,
// and the build didn't see a test add this one".
// Each way has a package, a test file, a built-in and a name of its own, so none opens what another writes. The package reads back what the test wrote:
// it lies in the lowest layer, whose code was compiled without the test in sight.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

type Way = { files: Record<string, string>; type?: "commonjs"; manifest?: string; helper?: string; test: string };
const ways: Record<string, Way> = {
  "new-name-on-prototype": {
    files: {
      "index.js": `import * as buffer from "node:buffer";\nexport const Handed = buffer.File;\nexport const read = () => File.prototype.planted;`,
    },
    test: `import { Handed, read } from "PACKAGE";\nHanded.prototype.planted = [7];`,
  },
  "member-of-prototype": {
    files: {
      "index.js": `export const Handed = globalThis.Headers;\nexport const read = () => new Headers().has("a");`,
    },
    test: `import { Handed, read } from "PACKAGE";\nHanded.prototype.has = () => "other";`,
  },
  "exported-in-a-list": {
    files: {
      "index.js": `const Native = globalThis.Number;\nexport { Native as Handed };\nexport const read = () => (1).toPrecision(2);`,
    },
    test: `import { Handed, read } from "PACKAGE";\nHanded.prototype.toPrecision = () => "other";`,
  },
  "default-export": {
    files: { "index.js": `export default URL;\nexport const read = () => new URL("http://a/").toJSON();` },
    test: `import Handed, { read } from "PACKAGE";\nHanded.prototype.toJSON = () => "other";`,
  },
  "export-star": {
    files: {
      "index.js": `export * from "./native.js";\nexport const read = () => new URLSearchParams("a=1").get("a");`,
      "native.js": `export const Handed = URLSearchParams;`,
    },
    test: `import { Handed, read } from "PACKAGE";\nHanded.prototype.get = () => "other";`,
  },
  "exported-again-by-name": {
    files: {
      "index.js": `export { Native as Handed } from "./native.js";\nexport const read = () => new TextEncoder().encode("a");`,
      "native.js": `export const Native = TextEncoder;`,
    },
    test: `import { Handed, read } from "PACKAGE";\nHanded.prototype.encode = () => "other";`,
  },
  "commonjs-exports": {
    type: "commonjs",
    files: { "index.js": `exports.Handed = TextDecoder;\nexports.read = () => new TextDecoder().decode();` },
    test: `import { Handed, read } from "PACKAGE";\nHanded.prototype.decode = () => "other";`,
  },
  "commonjs-module-exports": {
    type: "commonjs",
    files: { "index.js": `module.exports = { Handed: AbortController, read: () => new AbortController().abort() };` },
    test: `import parts from "PACKAGE";\nconst { read } = parts;\nparts.Handed.prototype.abort = () => "other";`,
  },
  "namespace-import": {
    files: { "index.js": `export const Handed = FormData;\nexport const read = () => new FormData().getAll("a");` },
    test: `import * as parts from "PACKAGE";\nconst { read } = parts;\nparts.Handed.prototype.getAll = () => "other";`,
  },
  "object-itself": {
    files: { "index.js": `export const handed = Math;\nexport const read = () => Math.hypot(3, 4);` },
    test: `import { handed, read } from "PACKAGE";\nhanded.hypot = () => "other";`,
  },
  "answered-by-function": {
    files: { "index.js": `export const ofReflect = () => Reflect;\nexport const read = () => Reflect.ownKeys({});` },
    test: `import { ofReflect, read } from "PACKAGE";\nofReflect().ownKeys = () => "other";`,
  },
  "defined": {
    files: { "index.js": `export const Handed = Response;\nexport const read = () => Response.prototype.defined;` },
    test: `import { Handed, read } from "PACKAGE";\nObject.defineProperty(Handed.prototype, "defined", { value: 7, configurable: true });`,
  },
  "assigned": {
    files: { "index.js": `export const Handed = Array;\nexport const read = () => [1].flat();` },
    test: `import { Handed, read } from "PACKAGE";\nObject.assign(Handed.prototype, { flat: () => "other" });`,
  },
  "spied-on": {
    files: {
      "index.js": `export const Handed = EventTarget;\nexport const read = () => new EventTarget().dispatchEvent(new Event("a"));`,
    },
    test: `import { Handed, read } from "PACKAGE";\nimport { spyOn } from "bun:test";\nspyOn(Handed.prototype, "dispatchEvent").mockImplementation(() => "other");`,
  },
  "exports-map": {
    manifest: `"exports": { ".": "./lib/main.js" }`,
    files: { "lib/main.js": `export const Handed = Request;\nexport const read = () => Request.prototype.mapped;` },
    test: `import { Handed, read } from "PACKAGE";\nHanded.prototype.mapped = 7;`,
  },
  "required": {
    type: "commonjs",
    files: {
      "index.js": `exports.Handed = DataView;\nexports.read = () => new DataView(new ArrayBuffer(1)).getInt8(0);`,
    },
    test: `const { Handed, read } = require("PACKAGE");\nHanded.prototype.getInt8 = () => "other";`,
  },
  "imported-by-call": {
    files: { "index.js": `export const Handed = Date;\nexport const read = () => new Date(0).getUTCDay();` },
    test: `const { Handed, read } = await import("PACKAGE");\nHanded.prototype.getUTCDay = () => "other";`,
  },
  "written-by-helper": {
    files: { "index.js": `export const Handed = WeakRef;\nexport const read = () => new WeakRef({}).deref();` },
    helper: `import { Handed } from "PACKAGE";\nexport function replace() {\n  Handed.prototype.deref = () => "other";\n}`,
    test: `import { read } from "PACKAGE";\nimport { replace } from "./HELPER";\nreplace();`,
  },
};

async function linesOf(flags: string[]) {
  const files: Record<string, string> = { "package.json": `{ "name": "p", "type": "module" }` };
  for (const [name, way] of Object.entries(ways)) {
    const manifest = `"name": "${name}", "version": "1.0.0", "type": "${way.type ?? "module"}"`;
    files[`node_modules/${name}/package.json`] = `{ ${[manifest, way.manifest].filter(Boolean).join(", ")} }`;
    for (const [path, text] of Object.entries(way.files)) files[`node_modules/${name}/${path}`] = text;
    if (way.helper) files[`${name}-helper.js`] = way.helper.replaceAll("PACKAGE", name);
    const [imports, write] = [way.test.replace(/\n[^\n]*$/, ""), way.test.replace(/^.*\n/s, "")];
    files[`${name}.test.js`] = `
      ${imports.replaceAll("PACKAGE", name).replaceAll("HELPER", `${name}-helper.js`)}
      import { test } from "bun:test";
      const say = console.error.bind(console);
      try {
        ${write}
      } catch (error) {
        say("OUT ${name} refused: " + error.message);
      }
      say("OUT ${name} " + String(read()));
      test("ran to its end", () => {});`;
  }
  using dir = tempDir("aot-built-ins-from-packages", files);
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return {
    lines: stderr
      .split("\n")
      .filter(line => /^(OUT|error|TypeError)/.test(line))
      .sort(),
    exitCode,
  };
}

test("a test writes on a built-in that a package exports", async () => {
  // Each test file has a realm of its own, as under --parallel.
  const plain = await linesOf(["--isolate"]);
  expect(plain.exitCode).toBe(0);
  expect(plain.lines).toHaveLength(Object.keys(ways).length);
  expect(plain.lines.filter(line => !/ (7|other)$/.test(line))).toEqual([]);
  expect(await linesOf(["--aot", "--isolate"])).toEqual(plain);
  // More source than fits the memory as one program: the run is built in layers.
  expect(await linesOf(["--aot", "--parallel=2", "--aot-memory-limit=1KB"])).toEqual(plain);
}, 480_000);
