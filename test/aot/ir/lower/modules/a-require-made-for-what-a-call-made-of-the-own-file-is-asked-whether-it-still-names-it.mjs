// The loads through a require that is made for the own file are bound when the program is built.
// Where its base is a text of the file's own, nothing can have changed it: no question, and the loads ask nothing.
// RUN(TEXT): lower
// TEXT-LABEL: function {{*}}name="byText"
// TEXT-NOT: BunFileURLToPath
// TEXT-NOT: WeakSet
// TEXT: Return
// What a constructor or a call made of such a text may be another thing by now: a member of the URL was stored to, the function that made it was replaced.
// Behind the call of createRequire() the value that it was given is asked whether its path lies in the folder of the file. If not, nothing throws: the require is noted.
// A load through it asks whether the require is noted, and a noted one is called as any function is: it is the host's own, made for the folder that the value names.
// RUN(OBJECT): lower
// OBJECT-LABEL: function {{*}}name="byObject"
// OBJECT: [[made]] = Call {{*}}calleeName="createRequire"
// OBJECT: = Builtin builtin=BunFileURLToPath
// OBJECT: = Builtin builtin=StringPrototypeLastIndexOf
// OBJECT: = Builtin builtin=WeakSetPrototypeAdd
// OBJECT-NEXT: = Call {{*}}, {{*}}, [[made]]
// OBJECT: = Builtin builtin=WeakSetPrototypeHas
// OBJECT-NEXT: = Call {{*}}, {{*}}, [[made]]
// OBJECT: EvaluateModule
// OBJECT-NOT: Throw
// OBJECT: = Call [[made]], -,
// RUN(PATH): lower
// PATH-LABEL: function {{*}}name="byPath"
// PATH: = Builtin builtin=WeakSetPrototypeAdd
// PATH: = Builtin builtin=WeakSetPrototypeHas
// No base decides which module a built-in's name loads: the load asks nothing.
// RUN(BUILTIN): lower
// BUILTIN-LABEL: function {{*}}name="aBuiltInModule"
// BUILTIN: = Builtin builtin=WeakSetPrototypeAdd
// BUILTIN-NOT: WeakSetPrototypeHas
// BUILTIN: Return
// The base decides which data file a name finds, as it decides for code: the load asks.
// RUN(DATA): lower
// DATA-LABEL: function {{*}}name="aDataFile"
// DATA: = Builtin builtin=WeakSetPrototypeAdd
// DATA: = Builtin builtin=WeakSetPrototypeHas

// FILE: main.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
export const byText = () => createRequire(import.meta.url)("./part.cjs");
export const byObject = () => {
  const own = new URL(import.meta.url);
  return createRequire(own)("./part.cjs");
};
export const byPath = () => createRequire(fileURLToPath(import.meta.url))("./part.cjs");
export const aBuiltInModule = () => createRequire(new URL(import.meta.url))("node:path");
export const aDataFile = () => createRequire(new URL(import.meta.url))("./data.json");

// FILE: data.json
{ "said": "data" }

// FILE: part.cjs
exports.said = "part";
