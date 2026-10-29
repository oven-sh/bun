// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: outcome sloppyText Vault arrow
// CHECK-LABEL: function {{*}}name="outcome"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_6]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = Call v1 calleeName="run"
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="show"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: v8 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_8]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Call v9, -, v7 calleeName="showThrown"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sloppyText"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: object, v2: object, v3: anything, v4: function, v5: anything, v6: int[0, 4294967295], v7: anything, v8: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v9 = CreateMappedArguments v4, v6, v8, v7
// CHECK-NEXT: v10 = ToThis v3
// CHECK-NEXT: v11 = NewObject layout=[[L_11]]
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: SetLiteralPrototype v11, v12
// CHECK-NEXT: v14 = FinishObject v11
// CHECK-NEXT: v15 = NewObject -, v9 layout=[[L_12]] fields=[0]
// CHECK-NEXT: v16 = ScopeHasBinding v14 key="eval"
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Jump -> next b6(v14, v17)
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = ScopeHasBinding v2 key="eval"
// CHECK-NEXT: Branch v18 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b6(v2, v19)
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Jump -> next b6(v20, v20)
// CHECK-NEXT: b6(v21, v22):
// CHECK-NEXT: v23 = TypeTest v21 testedType=object
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: v25 = PropGet v24 key="eval"
// CHECK-NEXT: Jump -> next b9(v25)
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: v27 = Builtin builtin=GlobalThis
// CHECK-NEXT: v28 = PropGet v27 key="eval" [isFreeName]
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v29)
// CHECK-NEXT: b9(v30):
// CHECK-NEXT: v31 = GetMappedArgument v9
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v33 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v34 = StrictEq v30, v33
// CHECK-NEXT: Branch v34 -> taken b10(), notTaken b11(| 0)
// CHECK-NEXT: b10():
// CHECK-NEXT: v35 = DirectEval v32, v10, v5, v9, v0, v14, v15, v2, v1 evalScope=e3
// CHECK-NEXT: Jump -> next b12(v35)
// CHECK-NEXT: b11(v36):
// CHECK-NEXT: v37 = Call v36, v22, v32 calleeName="eval"
// CHECK-NEXT: Jump -> next b12(v37)
// CHECK-NEXT: b12(v38):
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Vault"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v1 layout=[[L_14]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_14]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v0, v4 function=[[f_15]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=env [[L_16]] flags=[IsFromCompiler]}, {type=anything}, {type=undefined|null|Array<undefined|null|string> site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_18]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_20]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_22]] site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_24]] site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|boolean|number|string|symbol|bigint|[[L_26]] site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string|String flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|"({\"a\":1,\"b\":[2,3,{\"c\":null}]})" site=[[w_28]] flags=[OmitsNull, OmitsUndefined]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}] thisType={type=[[L_29]] site=[[w_30]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: env [[L_16]], v2: anything, v3: undefined|null|Array<undefined|null|string>, v4: undefined|null|[[f_18]], v5: undefined|null|[[f_20]], v6: undefined|null|[[f_22]], v7: undefined|null|[[f_24]], v8: undefined|null|boolean|number|string|symbol|bigint|[[L_26]], v9: undefined|null|string|String, v10: undefined|null|"({\"a\":1,\"b\":[2,3,{\"c\":null}]})", v11: object, v12: object, v13: function, v14: [[L_29]], v15: int[0, 4294967295], v16: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v17 = CreateUnmappedArguments v15, v16
// CHECK-NEXT: v18 = NewClosure v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v17, v17 function=[[f_31]]
// CHECK-NEXT: v19 = Call v18
// CHECK-NEXT: ReturnCall v19
// CHECK-NEXT: }
