import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

const files = {
  "lib/value.cjs": `module.exports = { shown: 1, also: "two" };`,
  "lib/names.cjs": `exports.read = 1;\nexports.unread = 2;`,
  "lib/module.ts": `export const shown = 1;\nexport function hidden() { return 2; }`,
  "one.test.ts": `
    import { test } from "bun:test";
    import { answers } from "./uses.cjs";
    test("answers", () => { for (const answer of answers()) console.log(String(answer)); });`,
};

// Nobody keeps what require("./lib/value.cjs") answers, one name of names.cjs is read, and one of module.ts.
const head = `
  const path = require("node:path");
  const own = key => key.includes(path.sep + "lib" + path.sep);
  const show = (key, exported) => path.basename(key) + ":" + typeof exported + ":" + Object.keys(exported).sort().join("+");
  require("./lib/value.cjs");
  const names = require("./lib/names.cjs");
  const ofModule = require("./lib/module.ts");`;

function uses(expression: string) {
  return {
    ...files,
    "uses.cjs": `${head}
      const atTop = ${expression};
      function inFunction() { return ${expression}; }
      class Holder { field = ${expression}; method() { return ${expression}; } }
      exports.answers = () => [atTop, inFunction(), new Holder().field, new Holder().method(), names.read, ofModule.shown];`,
  };
}

const forms = {
  "the chain in one piece": `Object.keys(require.cache).filter(own).map(key => show(key, require.cache[key].exports)).sort().join()`,
  "the entry in a variable": `(() => { const found = []; for (const key in require.cache) if (own(key)) { const entry = require.cache[key]; found.push(show(key, entry.exports)); } return found.sort().join(); })()`,
  "Object.values()": `Object.values(require.cache).filter(entry => own(entry.id)).map(entry => show(entry.id, entry.exports)).sort().join()`,
  "Object.entries()": `Object.entries(require.cache).filter(([key]) => own(key)).map(([key, entry]) => show(key, entry.exports)).sort().join()`,
  "a key that the file spells": `show("value.cjs", require.cache[require.resolve("./lib/value.cjs")].exports)`,
  "compared with undefined": `Object.keys(require.cache).filter(own).filter(key => require.cache[key].exports === undefined).map(key => path.basename(key)).sort().join()`,
};

for (const [title, expression] of Object.entries(forms))
  test(title, () => expectCompiledToRunAsPlain(uses(expression)));
