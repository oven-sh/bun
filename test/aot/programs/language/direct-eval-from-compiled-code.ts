// A direct eval in compiled code: what it returns for each kind of argument, what its text sees and changes around the call, what it declares in strict and in sloppy functions, how it fails, and what import() in the text resolves against. One row differs from plain Bun: `this` at the top level of a CommonJS file is the receiver of the call, the first `exports`, also in the text of a direct eval, where plain Bun has the module object.
const path = require("node:path");
module.exports = { marker: "direct eval" };
(globalThis as any).directEvalEvaluations = ((globalThis as any).directEvalEvaluations ?? 0) + 1;

const lines: string[] = [(function (this: any) { return this === undefined ? "strict" : "sloppy"; })()];

function show(value: any): string {
  if (typeof value === "string") {
    if (value.length <= 80) return JSON.stringify(value);
    return value.length + " characters, " + JSON.stringify(value.slice(0, 20)) + " to " + JSON.stringify(value.slice(-20));
  }
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (ArrayBuffer.isView(value)) return "[" + Array.from(value as any, show).join(",") + "]";
  if (value instanceof Set) return "Set[" + Array.from(value, show).join(",") + "]";
  if (value instanceof Map) return "Map[" + Array.from(value, ([key, item]) => show(key) + "=>" + show(item)).join(",") + "]";
  return "{" + Object.keys(value).map(key => key + ":" + show(value[key])).join(",") + "}";
}
function showThrown(thrown: any): string {
  if (!(thrown instanceof Error)) return "throws " + show(thrown);
  const showsMessage = thrown instanceof SyntaxError || thrown.message.startsWith("own ");
  return "throws " + thrown.constructor.name + (showsMessage ? ": " + thrown.message : "");
}
function outcome(run: () => any): string {
  try {
    return show(run());
  } catch (thrown) {
    return showThrown(thrown);
  }
}
function report(label: string, run: () => any): void {
  lines.push(label + ": " + outcome(run));
}

function sloppyText(text: any) { return eval(text); }
// Class code is always strict. Plain Bun's transpiler drops a "use strict" directive inside a function, which would leave the reference run without a strict caller.
class StrictCode {
  static text = function (text: any) { return eval(text); };
  static scope = function (this: any, parameter: number) {
    let local = 1; const fixed = 2; var variable = 3; const seen: any[] = []; const readers: any[] = [];
    const captured = () => local;
    seen.push(eval("parameter + local + fixed + variable + moduleLevel"));
    eval("local = 10; parameter = 20; variable = 30; moduleLevel += 1");
    seen.push(local, parameter, variable, moduleLevel, captured());
    seen.push(outcome(() => eval("fixed = 5")), fixed, outcome(() => eval("later")));
    let later = 4;
    seen.push(eval("later"), eval("typeof nowhere"), outcome(() => eval("nowhere")));
    seen.push(eval("arguments.length"), eval("typeof sloppyScope"), eval("typeof this"), eval("this == 7"), (() => eval("typeof this"))());
    const reader = eval("(() => local)"); local = 11; seen.push(reader());
    const writer = eval("(value => { local = value; })"); writer(12); seen.push(local, captured());
    for (let i = 0; i < 2; i++) readers.push(eval("(() => i)"));
    seen.push(readers.map(read => read()));
    try { throw "caught value"; } catch (problem) { seen.push(eval("problem")); }
    return seen;
  };
  static declares = function () {
    const seen: any[] = [eval("typeof declared"), eval("typeof declaredFunction")];
    eval(declaring);
    seen.push(eval("typeof declared"), eval("typeof declaredFunction"), eval("typeof scoped"), eval("typeof alsoScoped"), eval("typeof inBlock"));
    // @ts-expect-error only the text declares the name
    seen.push(typeof declared);
    // @ts-expect-error only the text declares the name
    seen.push(typeof declaredFunction);
    seen.push(outcome(() => eval("declaredFunction()")));
    seen.push(outcome(() => eval("declared = 5")), outcome(() => eval("declared")), outcome(() => eval("delete declared")), outcome(() => eval("typeof declared")));
    let taken = 1;
    try { eval("var taken = 2"); seen.push("declared"); } catch (error) { seen.push(showThrown(error)); }
    seen.push(taken);
    return seen;
  };
  static imports = function (): any[] {
    return [eval('import("node:path")'), eval('import("./direct-eval-from-compiled-code.ts")'), eval('import("./no-such-file.ts")')];
  };
}
const { text: strictText, scope: strictScope, declares: strictDeclares, imports: strictImports } = StrictCode;
function reportBoth(label: string, text: any, view: (result: any) => any = result => result): void {
  report("sloppy " + label, () => view(sloppyText(text)));
  report("strict " + label, () => view(strictText(text)));
}

// @ts-expect-error eval declares exactly one parameter
report("no argument", () => eval());
// @ts-expect-error eval declares exactly one parameter
report("two arguments", () => eval("1 + 1", (lines.push("second argument evaluated"), "2 + 2")));
for (const value of [42, null, undefined, true, 12n, Symbol.for("s")]) reportBoth("argument " + show(value), value);
const withToString = { toString() { return "1 + 1"; } };
reportBoth("object with toString is the result", withToString, result => result === withToString);
const stringObject = new String("1 + 1");
reportBoth("String object is the result", stringObject, result => result === stringObject);
for (const text of ["", "// only a comment", "1;;;", "var v = 5", "if (false) 1", "'é' + 'ü€'"]) reportBoth(show(text), text);
report("sloppy rope", () => sloppyText("1 + " + String(2)));
report("strict rope", () => strictText("1 + " + String(2)));
reportBoth("long text", "0" + " + 1".repeat(3000));

const jsonObject = '({"a":1,"b":[2,3,{"c":null}]})';
for (const text of [jsonObject, '[1,2,{"x":"y"}]', '("text")', "(1)", '({"a":1,"a":2})', "({a:1})", '({"a":1,})', '({"a":undefined})', ' ( {"a" : 1} ) ']) reportBoth(show(text), text);
reportBoth("__proto__ null sets the prototype", '({"__proto__":null})', result => Object.getPrototypeOf(result) === null);
reportBoth("__proto__ object", '({"__proto__":{"inherited":1}})', result => [result.inherited, Object.keys(result)]);
report("sloppy JSON text twice creates two objects", () => sloppyText(jsonObject) !== sloppyText(jsonObject));
report("strict JSON text twice creates two objects", () => strictText(jsonObject) !== strictText(jsonObject));

let moduleLevel = 100;
function sloppyScope(this: any, parameter: number) {
  let local = 1; const fixed = 2; var variable = 3; const seen: any[] = []; const readers: any[] = [];
  const captured = () => local;
  seen.push(eval("parameter + local + fixed + variable + moduleLevel"));
  eval("local = 10; parameter = 20; variable = 30; moduleLevel += 1");
  seen.push(local, parameter, variable, moduleLevel, captured());
  seen.push(outcome(() => eval("fixed = 5")), fixed, outcome(() => eval("later")));
  let later = 4;
  seen.push(eval("later"), eval("typeof nowhere"), outcome(() => eval("nowhere")));
  seen.push(eval("arguments.length"), eval("typeof sloppyScope"), eval("typeof this"), eval("this == 7"), (() => eval("typeof this"))());
  const reader = eval("(() => local)"); local = 11; seen.push(reader());
  const writer = eval("(value => { local = value; })"); writer(12); seen.push(local, captured());
  for (let i = 0; i < 2; i++) readers.push(eval("(() => i)"));
  seen.push(readers.map(read => read()));
  try { throw "caught value"; } catch (problem) { seen.push(eval("problem")); }
  return seen;
}
report("sloppy scope", () => (sloppyScope as any).call(7, 1, 2, 3));
report("strict scope", () => (strictScope as any).call(7, 1, 2, 3));

class Vault {
  #secret = 41;
  static #count = 1;
  base() { return "base"; }
  read() { return eval("this.#secret + 1"); }
  has(o: any) { return eval("#secret in o"); }
  static count() { return eval("Vault.#count"); }
}
class Deep extends Vault {
  note: string;
  constructor() {
    const before = eval("typeof new.target");
    super();
    this.note = before + " " + eval("new.target === Deep");
  }
  base() { return "deep"; }
  up() { return eval("super.base()"); }
  arrow() { return (() => eval("super.base() + this.base()"))(); }
}
function Target(this: any) {
  this.seen = eval("new.target === Target");
  this.inArrow = (() => eval("typeof new.target"))();
}
report("private field", () => new Vault().read());
report("private name in", () => [new Vault().has(new Vault()), new Vault().has({})]);
report("static private field", () => Vault.count());
report("new.target in a derived constructor", () => new Deep().note);
report("super in a method", () => new Deep().up());
report("super and this in an arrow function", () => new Deep().arrow());
report("new.target when constructed", () => new (Target as any)());
report("new.target when called", () => { const receiver: any = {}; Target.call(receiver); return receiver; });
for (const text of ["this === module.exports", "this === exports", "typeof require", "typeof __filename", "typeof new.target", "path === require('node:path')"]) {
  try {
    lines.push("top level " + text + ": " + show(eval(text)));
  } catch (thrown) {
    lines.push("top level " + text + ": " + showThrown(thrown));
  }
}

const declaring = "var declared = 1; function declaredFunction() { return 'called'; } let scoped = 2; const alsoScoped = 3; { function inBlock() {} }";
function sloppyDeclares() {
  const seen: any[] = [eval("typeof declared"), eval("typeof declaredFunction")];
  eval(declaring);
  seen.push(eval("typeof declared"), eval("typeof declaredFunction"), eval("typeof scoped"), eval("typeof alsoScoped"), eval("typeof inBlock"));
  // @ts-expect-error only the text declares the name
  seen.push(typeof declared);
  // @ts-expect-error only the text declares the name
  seen.push(typeof declaredFunction);
  seen.push(outcome(() => eval("declaredFunction()")));
  seen.push(outcome(() => eval("declared = 5")), outcome(() => eval("declared")), outcome(() => eval("delete declared")), outcome(() => eval("typeof declared")));
  let taken = 1;
  try { eval("var taken = 2"); seen.push("declared"); } catch (error) { seen.push(showThrown(error)); }
  seen.push(taken);
  return seen;
}
for (const activation of [1, 2]) {
  report("sloppy declarations, activation " + activation, sloppyDeclares);
  report("strict declarations, activation " + activation, strictDeclares);
}
lines.push("declared on the global object: " + typeof (globalThis as any).declared);
try {
  eval("var topLevelDeclared = 1");
  lines.push("declared at the top level: " + show([eval("typeof topLevelDeclared"), typeof (globalThis as any).topLevelDeclared]));
} catch (thrown) {
  lines.push("declared at the top level: " + showThrown(thrown));
}

function makeCounter() { let count = 0; return eval("(() => ++count)"); }
function repeated(n: number) { return eval("n * 2"); }
function siteA() { const v = "A"; return eval("v"); }
function siteB() { const v = "B"; return eval("v"); }
function nesting() {
  const local = 1;
  return [eval("eval('local + 1')"), eval("(function () { return eval('local'); })()"), eval("repeated(21)")];
}
report("two counters", () => { const first = makeCounter(), second = makeCounter(); return [first(), first(), first(), second()]; });
report("one site, five activations", () => [1, 2, 3, 4, 5].map(n => repeated(n)));
report("two sites, one text", () => [siteA(), siteB(), siteA()]);
report("nesting", nesting);

for (const text of ["1 +", "let let = 1", "}", "return 1", "break", "super.x", "this.#nope", "import.meta", "with ({ inWith: 1 }) inWith", "throw new RangeError('own thrown in text')", "throw 7", "null.x", "nowhere()", "1 + 1"]) reportBoth(show(text), text);

function notDirect() {
  const local = 1;
  const alias = eval;
  return {
    comma: (0, eval)("typeof local"),
    alias: alias("typeof local"),
    optionalCall: eval?.("typeof local"),
    member: globalThis.eval("typeof local"),
    element: [eval][0]("typeof local"),
    call: eval.call(null, "typeof local"),
  };
}
report("not direct", notDirect);
const callsLocalEval = new Function("eval", "return eval(1);");
report("local named eval: compiled arrow function", () => callsLocalEval((x: number) => x + 1));
report("local named eval: function from text", () => callsLocalEval(new Function("x", "return x + 2;")));
report("local named eval: eval", () => callsLocalEval(eval));
report("local named eval: not callable", () => callsLocalEval({}));
report("this of an indirect eval", () => (0, eval)("this === globalThis"));
report("var of an indirect eval", () => {
  (0, eval)("var indirectGlobal = 1");
  return [typeof (globalThis as any).indirectGlobal, delete (globalThis as any).indirectGlobal];
});

function sloppyImports(): any[] {
  return [eval('import("node:path")'), eval('import("./direct-eval-from-compiled-code.ts")'), eval('import("./no-such-file.ts")')];
}
const importViews: [string, (namespace: any) => any][] = [
  ["a built-in module", namespace => typeof namespace.join],
  ["this file", namespace => [namespace.default === module.exports, namespace.default?.marker]],
  ["a missing file", () => "found"],
];
function main(): void {
  // The runner starts in this folder, where a specifier resolved against the working directory would still find this file.
  process.chdir(require("node:os").tmpdir());
  Promise.allSettled([...sloppyImports(), ...strictImports()]).then(results => {
    results.forEach((result, index) => {
      const [label, view] = importViews[index % importViews.length];
      const mode = index < importViews.length ? "sloppy" : "strict";
      lines.push(mode + " import of " + label + ": " + (result.status === "fulfilled" ? show(view(result.value)) : "rejected"));
    });
    lines.push("evaluations: " + (globalThis as any).directEvalEvaluations);
    console.log(lines.join("\n"));
  });
}
setTimeout(main, 0);
