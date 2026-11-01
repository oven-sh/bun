// In a test run the built-in objects take new names and the globals take other values. Two things the compiler does with the top of a file lean on them:
// `const E = {}; E.a = 0;` is read as 0 where no setter and no read-only value above E answers for `a`, and `class K extends Date {}` is made at its first read, below Date.
// Each project is run compiled and by plain Bun, and says the same.
// ./parallel/constant-fields and ./parallel/late-definitions have what an executable lets through.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

async function saysTheSame(files: Record<string, string>) {
  using dir = tempDir("aot-defs-in-test-runs", { "package.json": "{}", ...files });
  const said = async (flags: string[]) => {
    const { stdout } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    return stdout.split("\n").filter(line => line.startsWith("says|"));
  };
  const plain = await said([]);
  expect(plain.length).toBeGreaterThan(0);
  expect(await said(["--aot"])).toEqual(plain);
}

const filled = (exported: string) => `
const E = {};
E.a = 0;
E.b = 1;
function F() {}
F.tag = 5;
${exported} () => [String(E.a), String(E.b), String(F.tag), Object.keys(E).join("/"), Object.keys(F).join("/")].join(" ");
`;

describe("a name is laid above before the file that assigns under it is loaded", () => {
  for (const [name, act] of Object.entries({
    "a setter on Object.prototype": `Object.defineProperty(Object.prototype, "a", { set(v) { console.log("says| setter a"); }, configurable: true });`,
    "a read-only value on Object.prototype": `Object.defineProperty(Object.prototype, "a", { value: "above", writable: false, configurable: true });`,
    "a setter on Function.prototype": `Object.defineProperty(Function.prototype, "tag", { set(v) { console.log("says| setter tag"); }, get() { return "above"; }, configurable: true });`,
    "a value on Object.prototype": `Object.prototype.a = "above";`,
    "nothing": "",
  })) {
    test(
      `${name}, CommonJS`,
      () =>
        saysTheSame({
          "lib.cjs": filled("exports.read ="),
          "main.test.js": `${act}\nconst { read } = require("./lib.cjs");\ntest("reads", () => { console.log("says|", read()); });`,
        }),
      240_000,
    );
    test(
      `${name}, modules`,
      () =>
        saysTheSame({
          "lib.mjs": filled("export const read ="),
          "first.mjs": act,
          "main.test.mjs": `import "./first.mjs";\nimport { test } from "bun:test";\nlet read, failed;\ntry { ({ read } = await import("./lib.mjs")); } catch (e) { failed = e.name; }\ntest("reads", () => { console.log("says|", read ? read() : "import failed: " + failed); });`,
        }),
      240_000,
    );
  }
});

describe("a class below a global that the test replaces", () => {
  for (const global of ["Error", "Date", "Map", "Array", "Promise", "EventTarget", "URL", "Uint8Array", "RegExp"]) {
    const fake = `globalThis.${global} = class Fake { fake = true; };`;
    const load = `const { read } = require("./lib.cjs");`;
    const probe = `(() => { const K = read(); const above = getPrototypeOf(K); let made; try { made = new K(); } catch (e) { made = { threw: e.name }; } return [above.name, above === globalThis.${global}, made.fake === true, made.threw].join(); })()`;
    for (const [when, order] of [
      ["before the file of the class is loaded", `${fake}\n${load}`],
      ["between the declaration and the first read", `${load}\n${fake}`],
    ])
      test(
        `${global}, ${when}`,
        () =>
          saysTheSame({
            "lib.cjs": `class K extends ${global} {}\nexports.read = () => K;`,
            "main.test.js": `const real = globalThis.${global}, { getPrototypeOf } = Object;\n${order}\nconst answer = ${probe};\nglobalThis.${global} = real;\ntest("reads", () => { console.log("says|", answer); });`,
          }),
        240_000,
      );
  }
});
