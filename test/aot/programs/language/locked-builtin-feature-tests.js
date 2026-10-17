// Feature tests of built-ins that a program compiled ahead of time cannot replace are decided at the build. What they say is what plain Bun says.
const said = [];
const t = (what, value) => said.push(what + " " + value);
t("Symbol", typeof Symbol); t("Promise", typeof Promise === "undefined"); t("WeakMap", typeof WeakMap !== "undefined" ? "there" : "not there"); t("BigInt", typeof BigInt === "function");
t("Math", typeof Math); t("JSON", typeof JSON); t("Reflect", typeof Reflect === "object"); t("globalThis", typeof globalThis); t("undefined", typeof undefined);
t("by globalThis", typeof globalThis.Map); t("assign", !Object.assign); t("typeof assign", typeof Object.assign !== "function"); t("includes", !Array.prototype.includes); t("not not", !!Object.setPrototypeOf);
if (typeof Symbol !== "function") t("polyfill", "runs"); else t("polyfill", "does not run");
const assign = typeof Object.assign === "function" ? Object.assign : function () { return "mine"; };
t("taken", assign({}, { a: 1 }).a);
// A name that the file binds is the file's.
function shadowed() { const Symbol = 5; const Object = { assign: 0 }; return [typeof Symbol, !Object.assign, typeof Object.assign].join(); }
t("shadowed", shadowed());
function parameter(Map, globalThis) { return [typeof Map, typeof globalThis.Set].join(); }
t("parameter", parameter("text", { Set: 1 }));
// What may be replaced, and what is no function, is asked when the program runs.
t("Buffer", typeof Buffer); t("console", typeof console); t("NaN", !NaN); t("Infinity", !Infinity); t("no such", typeof Object.noSuchThing); t("no such global", typeof noSuchGlobalAnywhere);
console.log(said.join("\n"));
