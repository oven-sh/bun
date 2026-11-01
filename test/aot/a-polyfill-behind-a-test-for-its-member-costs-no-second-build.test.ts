// A package brings a member of a built-in object for engines that lack it, behind a test for that member. Bun has the member, so the store
// never runs. A test run that took the store for a replacement found it behind the load, threw away all that was loaded and began again.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const head = `var _a, _c, f = function () { return 1; };\n`;

const behindATest = {
  "nullish-assignment": `Symbol.dispose ??= Symbol.for("d");`,
  "lowered-by-typescript": `(_a = (_c = Symbol).dispose) !== null && _a !== void 0 ? _a : (_c.dispose = Symbol.for("d"));`,
  "lowered-by-esbuild": `(_a = Symbol.dispose) != null ? _a : Symbol.dispose = Symbol.for("d");`,
  "or": `Symbol.dispose || (Symbol.dispose = Symbol.for("d"));`,
  "nullish": `Symbol.dispose ?? (Symbol.dispose = Symbol.for("d"));`,
  "if-not": `if (!Symbol.dispose) Symbol.dispose = Symbol.for("d");`,
  "if-not-in-a-block": `if (!Array.prototype.at) { _c = 1; Array.prototype.at = f; }`,
  "else": `if (Array.prototype.at) _c = 1; else Array.prototype.at = f;`,
  "typeof": `if (typeof Symbol.dispose === "undefined") Symbol.dispose = Symbol.for("d");`,
  "equals-null": `if (Symbol.dispose == null) Symbol.dispose = Symbol.for("d");`,
  "in": `"dispose" in Symbol || (Symbol.dispose = Symbol.for("d"));`,
  "define-property": `Symbol.dispose === undefined && Object.defineProperty(Symbol, "dispose", { value: Symbol.for("d") });`,
};

const notBehindOne = {
  "in-the-arm-that-is-taken": `if (Array.prototype.at) Array.prototype.at = f;`,
  "the-else-arm-of-a-not": `if (!Array.prototype.at) {} else { Array.prototype.at = f; }`,
  "a-variable-with-two-values": `_a = Array.prototype.at; _a = undefined; _a !== void 0 ? _a : (Array.prototype.at = f);`,
  "a-test-nobody-knows-beside-it": `(!Array.prototype.at || process.argv.length) && (Array.prototype.at = f);`,
  "behind-the-if-and-not-in-it": `if (!Array.prototype.at) { _c = 1; } Array.prototype.at = f;`,
  "and-where-or-is-meant": `Array.prototype.at && (Array.prototype.at = f);`,
  "an-accessor-that-answers-an-empty-text": `if (!RegExp.prototype.flags) Object.defineProperty(RegExp.prototype, "flags", { get: f, configurable: true });`,
  "the-first-arm-of-a-lowered-form": `(_a = Array.prototype.at) !== null && _a !== void 0 ? (Array.prototype.at = f) : _a;`,
  "not-equal-where-equal-is-meant": `if (Array.prototype.at != null) Array.prototype.at = f;`,
  "a-function-that-is-called-later": `function later() { Array.prototype.at = f; } if (!Array.prototype.at) _c = 1; later();`,
};

async function runBoth(name: string, packages: Record<string, string>) {
  using dir = tempDir(name, {
    "package.json": `{ "name": "${name}", "type": "module" }`,
    ...Object.fromEntries(
      Object.entries(packages).flatMap(([name, text]) => [
        [`node_modules/${name}/package.json`, `{ "name": "${name}", "version": "1.0.0", "main": "index.js" }`],
        [`node_modules/${name}/index.js`, `${head}${text}\nexports.v = 1;\n`],
      ]),
    ),
    "a.test.js": `${Object.keys(packages)
      .map(name => `import "${name}";\n`)
      .join("")}import { test } from "bun:test";
test("what the packages left", () => {
  console.error("SEEN " + [[5].at(0), typeof Symbol.dispose, Symbol.dispose === Symbol.for("d"), typeof RegExp.prototype.flags].join(" "));
});
`,
  });
  const seenWith = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
    const lines = (stdout + "\n" + stderr).split("\n");
    const replacing = lines.filter(line => line.startsWith("AOT test run | ") && line.includes(" replaces: "));
    return {
      seen: lines.filter(line => line.startsWith("SEEN ")),
      exitCode,
      startsOver: lines.filter(line => line.startsWith("AOT build starts over | replaced built-ins added")).length,
      replacing: [...new Set(replacing.map(line => line.match(/node_modules[\\/]([^\\/]+)[\\/]/)?.[1]))].sort(),
    };
  };
  return await Promise.all([seenWith({}), seenWith({ BUN_JSC_logAOTPhaseTimes: "1" }, "--aot")]);
}

test("a store behind a test that finds the member missing replaces nothing, and the run is built once", async () => {
  const [plain, compiled] = await runBoth("aot-polyfills-behind-a-test", behindATest);
  expect(plain).toEqual({ seen: ["SEEN 5 symbol false string"], exitCode: 0, startsOver: 0, replacing: [] });
  expect(compiled).toEqual(plain);
});

test("a store that only looks as if it stood behind such a test replaces the member", async () => {
  const [plain, compiled] = await runBoth("aot-stores-not-behind-a-test", notBehindOne);
  expect(plain).toEqual({ seen: ["SEEN 1 symbol false number"], exitCode: 0, startsOver: 0, replacing: [] });
  expect(compiled).toEqual({ ...plain, startsOver: 1, replacing: Object.keys(notBehindOne).sort() });
});
