// `./lib/code.mjs?raw` is the text of the file, which does not run. Only a `type` attribute goes before `?raw`, and no other query says how a file is read.
import { createRequire } from "node:module";
import moduleText from "./lib/code.mjs?raw";
import commonjsText from "./lib/code.cjs?raw";
import typedText from "./lib/typed.ts?raw";
import jsonText from "./lib/data.json?raw";
import tomlText from "./lib/data.toml?raw";
import yamlText from "./lib/data.yaml?raw";
import wordsText from "./lib/words.txt?raw";
import unnamedText from "./lib/data.kind-that-nothing-names?raw";
import styleText from "./lib/style.css?raw";
import pageText from "./lib/page.html?raw";
import notesText from "./lib/notes.md?raw";
import declarationsText from "./lib/declarations.d.ts?raw";
import addonText from "./lib/no-addon.node?raw";
import withoutExtension from "./lib/code?raw";
import * as namespace from "./lib/code.mjs?raw";
import * as jsonNamespace from "./lib/data.json?raw";
import { handedOn, handedOnWhole } from "./lib/hands-on.mjs";
import { lengthOfText, kindOfText } from "./lib/typed-importer.ts";
import ownText from "./main.mjs?raw";
import * as code from "./lib/code.mjs";
import data from "./lib/data.json";
import upperCase from "./lib/data.json?RAW";
import withValue from "./lib/data.json?raw=1";
import withMore from "./lib/data.json?raw&x";
import second from "./lib/data.json?x&raw";
import withFragment from "./lib/data.json?raw#x";
import twice from "./lib/data.json?raw?raw";
import asText from "./lib/data.toml?text";
import asUrl from "./lib/data.json?url";
import byAttribute from "./lib/data.json?raw" with { type: "json" };
import textByBoth from "./lib/data.json?raw" with { type: "text" };
import textByAttribute from "./lib/data.json" with { type: "text" };
import * as styleNamespace from "./lib/style.css?raw";
import * as styleByBoth from "./lib/style.css?raw" with { type: "text" };
import * as wordsNamespace from "./lib/words.txt?raw";
import * as wordsByBoth from "./lib/words.txt?raw" with { type: "text" };

const show = value => `${typeof value} ${JSON.stringify(value)}`;
console.log("ran:", JSON.stringify(globalThis.ran));

for (const text of [
  moduleText,
  commonjsText,
  typedText,
  jsonText,
  tomlText,
  yamlText,
  wordsText,
  unnamedText,
  styleText,
  pageText,
  notesText,
  declarationsText,
  addonText,
  withoutExtension,
]) {
  console.log(show(text));
}
console.log(Object.keys(namespace).join(), namespace.default === moduleText, namespace.v);
console.log(Object.keys(jsonNamespace).join(), jsonNamespace.default === jsonText, jsonNamespace.a);
console.log(show(handedOn), Object.keys(handedOnWhole).join(), handedOnWhole === jsonNamespace);
console.log(lengthOfText, kindOfText);
console.log(typeof ownText, ownText.includes("typeof ownText"));
console.log(code.v, show(data));

for (const value of [upperCase, withValue, withMore, second, withFragment, twice, asText, asUrl]) console.log(show(value));
console.log(show(byAttribute), show(textByBoth), show(textByAttribute));
console.log(styleNamespace === styleByBoth, styleNamespace.default === styleByBoth.default);
console.log(wordsNamespace === wordsByBoth, wordsNamespace.default === wordsByBoth.default);

const called = await import("./lib/code.mjs?raw");
const onlyCalled = await import("./lib/only-called.mjs?raw");
const calledWithAttribute = await import("./lib/only-called.mjs?raw", { with: { type: "text" } });
console.log(called === namespace, Object.keys(onlyCalled).join(), show(onlyCalled.default), show(calledWithAttribute.default));

async function inFunction() {
  return await import("./lib/in-function.mjs?raw");
}
class Loads {
  inField = import("./lib/in-field.mjs?raw");
  inMethod() {
    return import("./lib/in-method.mjs?raw");
  }
}
for (const loaded of [await inFunction(), await new Loads().inField, await new Loads().inMethod()]) {
  console.log(Object.keys(loaded).join(), show(loaded.default));
}

const madeAtRunTime = await import("./lib/style.css?" + ["r", "a", "w"].join(""));
console.log(madeAtRunTime === styleNamespace);

const require = createRequire(import.meta.url);
console.log(JSON.stringify(require("./lib/requires.cjs")));
console.log(import.meta.resolve("./lib/code.mjs?raw").replace(/.*\/lib/, "lib"));

console.log("ran:", JSON.stringify(globalThis.ran));
