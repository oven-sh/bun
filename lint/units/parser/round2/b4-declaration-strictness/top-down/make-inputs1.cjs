// Inputs of the probe, part 1: TS2880 (assert), TS1357 (enum members), TS1260 (escaped keywords), and which sink reads a type in a lint parse.
// usage: node make-inputs1.cjs > inputs1.json      each entry: { g: group, s: source, l: ts|tsx|js|jsx|dts }
const out = [];
let group = "";
const g = name => { group = name; };
const t = (s, l) => out.push({ g: group, s, l: l || "ts" });

g("A1 assert after the module specifier of an import: tryParseImportAttributes (parser.go:2545)");
t('import a from "a" assert { type: "json" };');
t('import "a" assert { type: "json" };');
t('import * as a from "a" assert { type: "json" };');
t('import { a } from "a" assert { type: "json" };');
t('import a, { b } from "a" assert { type: "json" };');
t('import a from "a" assert {};');
t('import a from "a" assert { type: "json", };');
t('import a from "a" assert { "type": "json" };');
t('import a from "a" assert { type: "json" }\nlet x;');
t('import a from "a"\nassert { type: "json" };');
t('import a from "a" /* c */ assert { type: "json" };');
t('import a from "a" assert');
t('import a from "a" assert;');
t('import a from "a" assert { type };');
t('import a from "a" assert { 1: "json" };');
t('import a from "a" assert { type: 1 };');
t('import type a from "a" assert { type: "json" };');
t('import type { a } from "a" assert { "resolution-mode": "import" };');
t('import a from "a" with { type: "json" };');
t('import a from "a"\nwith { type: "json" };');
t('import a from "a" with { type: "json", };');
t('import a from "a" with {};');
t('import a from "a" with');
t('import a from "a" with { 1: "json" };');
t('import a from "a" with { type: "json" } assert { type: "json" };');
t('import a from "a" assert { type: "json" };', "js");
t('import a from "a" assert { type: "json" };', "tsx");
t('import a from "a" assert { type: "json" };', "dts");
t('import a = require("a") assert { type: "json" };');
t('import("a", { assert: { type: "json" } });');
t('import a from `a` assert { type: "json" };');

g("A2 assert after the module specifier of an export: parseExportDeclaration (parser.go:2612)");
t('export * from "a" assert { type: "json" };');
t('export * as ns from "a" assert { type: "json" };');
t('export { a } from "a" assert { type: "json" };');
t('export { a as b } from "a" assert { type: "json" };');
t('export {} from "a" assert { type: "json" };');
t('export type { a } from "a" assert { type: "json" };');
t('export type * from "a" assert { type: "json" };');
t('export { a } from "a"\nassert { type: "json" };');
t('export { a } from "a" with { type: "json" };');
t('export { a } from "a"\nwith { type: "json" };');
t('export * from "a"\nwith { type: "json" };');
t('export * from "a"\nassert { type: "json" };');
t('let a; export { a } assert { type: "json" };');
t('export * from "a" assert { type: "json" };', "js");
t('export * from "a" assert');

g("A3 assert in an import type: parseImportType (parser.go:3085)");
t('let x: import("a", { assert: { "resolution-mode": "import" } }).T;');
t('let x: import("a", { with: { "resolution-mode": "import" } }).T;');
t('let x: typeof import("a", { assert: { "resolution-mode": "import" } });');
t('let x: import("a", { assert: {} });');
t('let x: import("a", { assert: { a: "b" }, });');
t('let x: import("a", { assert: { a: "b", } });');
t('let x: import("a", { assert });');
t('let x: import("a", { other: { a: "b" } });');
t('let x: import("a", { });');
t('let x: import("a", );');
t('type T = import("a", { assert: { "resolution-mode": "import" } }).T;');
t('type T = typeof import("a", { assert: { "resolution-mode": "import" } });');
t('interface I { a: import("a", { assert: { "resolution-mode": "import" } }).T }');
t('interface I extends A<import("a", { assert: { a: "b" } })> {}');
t('function f(a: import("a", { assert: { a: "b" } })) {}');
t('function f(): import("a", { assert: { a: "b" } }) {}');
t('declare function f(a: import("a", { assert: { a: "b" } })): void;');
t('class C { a: import("a", { assert: { a: "b" } }) }');
t('class C { [k: string]: import("a", { assert: { a: "b" } }) }');
t('class C<T extends import("a", { assert: { a: "b" } })> {}');
t('class C implements I<import("a", { assert: { a: "b" } })> {}');
t('class C extends B<import("a", { assert: { a: "b" } })> {}');
t('x as import("a", { assert: { a: "b" } });');
t('x satisfies import("a", { assert: { a: "b" } });');
t('<import("a", { assert: { a: "b" } })>x;');
t('f<import("a", { assert: { a: "b" } })>(x);');
t('new A<import("a", { assert: { a: "b" } })>();');
t('let f = (a: import("a", { assert: { a: "b" } })) => 1;');
t('let f = (a): import("a", { assert: { a: "b" } }) => 1;');
t('let f = <T extends import("a", { assert: { a: "b" } })>(a: T) => 1;');
t('let f = async <T extends import("a", { assert: { a: "b" } })>(a: T) => 1;');
t('let f = a ? (b): import("a", { assert: { a: "b" } }) => 1 : 2;');
t('declare let x: import("a", { assert: { a: "b" } });');
t('declare namespace N { let x: import("a", { assert: { a: "b" } }); }');
t('namespace N { export let x: import("a", { assert: { a: "b" } }); }');
t('enum E { a = <import("a", { assert: { a: "b" } })>1 }');
t('try {} catch (e: import("a", { assert: { a: "b" } })) {}');
t('for (let x: import("a", { assert: { a: "b" } }) of y) {}');
t('abstract class C { abstract m(a: import("a", { assert: { a: "b" } })): void }');
t('class C { m(a: import("a", { assert: { a: "b" } })): void; m(a: any) {} }');
t('class C { declare a: import("a", { assert: { a: "b" } }) }');
t('function f(this: import("a", { assert: { a: "b" } })) {}');
t('let x: { a: import("a", { assert: { a: "b" } }) };');
t('let x: [import("a", { assert: { a: "b" } })];');
t('let x: (a: import("a", { assert: { a: "b" } })) => void;');
t('let x: A<import("a", { assert: { a: "b" } })>;');
t('let x: import("a", { assert: { a: "b" } })', "dts");
t('<A<import("a", { assert: { a: "b" } })> />;', "tsx");
t('let x: import("a", { assert: { a: "b" } })', "js");

g("S which sink reads the type: `A | () => void` is TS1385 only where the sink builds");
const probeType = "A | () => void";
for (const [name, src, lang] of [
  ["variable", `let x: ${probeType};`],
  ["type alias", `type T = ${probeType};`],
  ["interface member", `interface I { a: ${probeType} }`],
  ["interface extends argument", `interface I extends B<${probeType}> {}`],
  ["interface type parameter", `interface I<T extends ${probeType}> {}`],
  ["type alias type parameter", `type T<U extends ${probeType}> = U;`],
  ["parameter", `function f(a: ${probeType}) {}`],
  ["return type", `function f(): ${probeType} {}`],
  ["declare function parameter", `declare function f(a: ${probeType}): void;`],
  ["overload parameter", `function f(a: ${probeType}): void; function f(a: any) {}`],
  ["class field", `class C { a: ${probeType} }`],
  ["class declare field", `class C { declare a: ${probeType} }`],
  ["class abstract field", `abstract class C { abstract a: ${probeType} }`],
  ["class index signature value", `class C { [k: string]: ${probeType} }`],
  ["class index signature parameter", `class C { [k: ${probeType}]: any }`],
  ["class method parameter", `class C { m(a: ${probeType}) {} }`],
  ["class method overload", `class C { m(a: ${probeType}): void; m(a: any) {} }`],
  ["class abstract method", `abstract class C { abstract m(a: ${probeType}): void }`],
  ["class type parameter", `class C<T extends ${probeType}> {}`],
  ["class implements argument", `class C implements I<${probeType}> {}`],
  ["class extends argument", `class C extends B<${probeType}> {}`],
  ["declare class field", `declare class C { a: ${probeType} }`],
  ["declare class method", `declare class C { m(a: ${probeType}): void }`],
  ["constructor parameter property", `class C { constructor(public a: ${probeType}) {} }`],
  ["accessor return", `class C { get a(): ${probeType} { return 1 as any } }`],
  ["setter parameter", `class C { set a(v: ${probeType}) {} }`],
  ["as", `x as ${probeType};`],
  ["satisfies", `x satisfies ${probeType};`],
  ["angle assertion", `<${probeType}>x;`],
  ["call type argument", `f<${probeType}>(x);`],
  ["new type argument", `new A<${probeType}>();`],
  ["tagged template type argument", "f<" + probeType + ">`a`;"],
  ["instantiation expression", `let y = f<${probeType}>;`],
  ["arrow parameter", `let f = (a: ${probeType}) => 1;`],
  ["arrow return", `let f = (a): (${probeType}) => 1;`],
  ["arrow type parameter", `let f = <T extends ${probeType}>(a: T) => 1;`],
  ["async arrow type parameter", `let f = async <T extends ${probeType}>(a: T) => 1;`],
  ["function type parameter", `function f<T extends ${probeType}>() {}`],
  ["method type parameter", `class C { m<T extends ${probeType}>() {} }`],
  ["object method type parameter", `({ m<T extends ${probeType}>() {} });`],
  ["object method parameter", `({ m(a: ${probeType}) {} });`],
  ["declare variable", `declare let x: ${probeType};`],
  ["declare namespace variable", `declare namespace N { let x: ${probeType}; }`],
  ["namespace variable", `namespace N { export let x: ${probeType}; }`],
  ["catch binding", `try {} catch (e: ${probeType}) {}`],
  ["for of binding", `for (let x: ${probeType} of y) {}`],
  ["this parameter", `function f(this: ${probeType}) {}`],
  ["definite variable", `let x!: ${probeType};`],
  ["optional parameter", `function f(a?: ${probeType}) {}`],
  ["rest parameter", `function f(...a: ${probeType}) {}`],
  ["destructured parameter", `function f({ a }: ${probeType}) {}`],
  ["declare module function", `declare module "m" { function f(a: ${probeType}): void; }`],
  ["declare global variable", `declare global { var x: ${probeType}; }`],
  ["export declare const", `export declare const x: ${probeType};`],
  ["enum initializer assertion", `enum E { a = <${probeType}>1 }`],
  ["jsx type argument", `<A<${probeType}> />;`, "tsx"],
  ["declaration file variable", `let x: ${probeType};`, "dts"],
  ["declaration file function", `function f(a: ${probeType}): void;`, "dts"],
  ["declaration file class", `class C { a: ${probeType}; m(a: ${probeType}): void }`, "dts"],
]) {
  out.push({ g: group, s: src, l: lang || "ts", n: name });
}

g("E1 enum members: parseDelimitedList(PCEnumMembers) (parser.go:652-700), TS1357 at :677");
t("enum E { a b }");
t("enum E { a = 1 b }");
t("enum E { a, b c }");
t("enum E { a b = 1 }");
t("enum E { a\n b }");
t("enum E { a; b }");
t("enum E { a; }");
t("enum E { a, b; }");
t("enum E { a = 1; b = 2 }");
t("enum E { a");
t("enum E { a,");
t("enum E { a = 1");
t("enum E { a: 1 }");
t("enum E { a() {} }");
t("enum E { a = 1 + }");
t("enum E { a.b }");
t("enum E { a? }");
t("enum E { a! }");
t("enum E { 'a' b }");
t("enum E { ['a'] b }");
t("enum E { a 'b' }");
t("enum E { a 1 }");
t("enum E { a [b] }");
t("enum E { a }");
t("enum E { a, }");
t("enum E { a,, b }");
t("enum E { , }");
t("enum E { , a }");
t("enum E { 1 }");
t("enum E { 1 = 1 }");
t("enum E { 1n }");
t("enum E { [x] }");
t("enum E { [x] = 1 }");
t("enum E { ['a'] }");
t("enum E { [`a`] }");
t("enum E { [`a${b}`] }");
t("enum E { [1] }");
t("enum E { #a }");
t("enum E { #a = 1 }");
t("enum E { class }");
t("enum E { class = 1, if }");
t("enum E { = 1 }");
t("enum E { + }");
t("enum E { } }");
t("enum E { a ) }");
t("enum E { a = 1, ) }");
t("enum E {");
t("enum E");
t("enum { a }");
t("enum E F { a }");
t("enum 1 { a }");
t("enum class { a }");
t("const enum E { a b }");
t("declare enum E { a b }");
t("declare enum E { a; b }");
t("export enum E { a b }");
t("namespace N { enum E { a b } }");
t("enum E { a b }", "dts");
t("enum E { a\n= 1 }");
t("enum E { a = 1\n, b }");
t("enum E { a /* c */ b }");
t("enum E { a = yield }");
t("enum E { a = await 1 }");
t("enum E { a = b in c }");
t("enum E { a, b\n c }");

g("K1 a reserved word spelled with an escape: nextToken (parser.go:384-392)");
const esc = w => "\\u00" + w.charCodeAt(0).toString(16).padStart(2, "0") + w.slice(1);
t(`${esc("var")} x = 1;`);
t(`v\\u0061r x = 1;`);
t(`v\\u{61}r x = 1;`);
t(`${esc("if")} (x) {}`);
t(`${esc("class")} C {}`);
t(`${esc("function")} f() {}`);
t(`${esc("return")};`);
t(`function f() { ${esc("return")} 1 }`);
t(`${esc("typeof")} x;`);
t(`${esc("void")} 0;`);
t(`${esc("new")} A();`);
t(`${esc("this")}.x;`);
t(`x = ${esc("this")};`);
t(`x = ${esc("null")};`);
t(`x = ${esc("true")};`);
t(`x = ${esc("false")};`);
t(`x ${esc("in")} y;`);
t(`x ${esc("instanceof")} y;`);
t(`${esc("delete")} x.y;`);
t(`${esc("for")} (;;) {}`);
t(`${esc("while")} (x) {}`);
t(`${esc("do")} {} while (x)`);
t(`do {} ${esc("while")} (x)`);
t(`${esc("switch")} (x) {}`);
t(`switch (x) { ${esc("case")} 1: }`);
t(`switch (x) { ${esc("default")}: }`);
t(`${esc("try")} {} catch {}`);
t(`try {} ${esc("catch")} {}`);
t(`try {} ${esc("finally")} {}`);
t(`${esc("throw")} x;`);
t(`${esc("break")};`);
t(`for (;;) { ${esc("continue")}; }`);
t(`${esc("const")} x = 1;`);
t(`${esc("import")} a from "a";`);
t(`${esc("export")} {};`);
t(`export ${esc("default")} 1;`);
t(`class C ${esc("extends")} B {}`);
t(`${esc("enum")} E {}`);
t(`${esc("with")} (x) {}`);
t(`${esc("debugger")};`);
t(`if (x) {} ${esc("else")} {}`);
t(`x = ${esc("super")}.y;`);
t(`class C { m() { ${esc("super")}.m() } }`);
t(`x.${esc("var")};`);
t(`x?.${esc("class")};`);
t(`({ ${esc("var")}: 1 });`);
t(`({ ${esc("if")}() {} });`);
t(`class C { ${esc("class")}() {} }`);
t(`class C { ${esc("if")} = 1 }`);
t(`import { ${esc("default")} as a } from "a";`);
t(`export { a as ${esc("default")} };`);
t(`var ${esc("var")} = 1;`);
t(`let ${esc("class")} = 1;`);
t(`function ${esc("if")}() {}`);
t(`function f(${esc("class")}) {}`);
t(`var { ${esc("var")} } = x;`);
t(`var { ${esc("var")}: a } = x;`);
t(`${esc("var")}: for (;;) {}`);
t(`x = ${esc("class")} {};`);
t(`x = ${esc("function")}() {};`);
t(`let x: ${esc("void")};`);
t(`let x: ${esc("typeof")} y;`);
t(`let x: ${esc("null")};`);
t(`let x: ${esc("this")};`);
t(`let x: { ${esc("in")}: 1 };`);
t(`type T = { [K ${esc("in")} U]: 1 };`);
t(`type T = A ${esc("extends")} B ? 1 : 2;`);
t(`enum E { ${esc("var")} }`);
t(`<${esc("const")}>x;`);
t(`x = ${esc("new")}.target;`);
t(`x = ${esc("import")}.meta;`);
t(`x = ${esc("import")}("a");`);
t(`${esc("var")} x = 1;`, "js");
t(`x.${esc("var")};`, "js");
t(`${esc("var")}`);
t(`${esc("var")};`);
t(`x = ${esc("var")};`);
t(`x = 1 + ${esc("class")};`);
t(`f(${esc("if")});`);
t(`[${esc("else")}];`);
t(`${esc("else")}`);
t(`{ ${esc("case")} }`);
t(`x = ${esc("typeof")};`);

g("K2 a contextual keyword spelled with an escape");
t(`${esc("async")} function f() {}`);
t(`x = ${esc("async")} () => 1;`);
t(`x = ${esc("async")} y => 1;`);
t(`${esc("let")} x = 1;`);
t(`${esc("type")} T = 1;`);
t(`${esc("interface")} I {}`);
t(`${esc("declare")} const x: 1;`);
t(`${esc("abstract")} class C {}`);
t(`${esc("namespace")} N {}`);
t(`${esc("module")} N {}`);
t(`${esc("global")} {}`);
t(`class C { ${esc("static")} x = 1 }`);
t(`class C { ${esc("public")} x = 1 }`);
t(`class C { ${esc("readonly")} x = 1 }`);
t(`class C { ${esc("get")} x() { return 1 } }`);
t(`class C { ${esc("set")} x(v) {} }`);
t(`class C { ${esc("async")} m() {} }`);
t(`class C { ${esc("declare")} x: 1 }`);
t(`class C { ${esc("accessor")} x = 1 }`);
t(`class C { ${esc("constructor")}() {} }`);
t(`class C ${esc("implements")} I {}`);
t(`x ${esc("as")} T;`);
t(`x ${esc("satisfies")} T;`);
t(`import * ${esc("as")} a from "a";`);
t(`import a ${esc("from")} "a";`);
t(`import { a ${esc("as")} b } from "a";`);
t(`import ${esc("type")} { a } from "a";`);
t(`for (x ${esc("of")} y) {}`);
t(`function* g() { ${esc("yield")} 1 }`);
t(`async function f() { ${esc("await")} 1 }`);
t(`let x: ${esc("keyof")} T;`);
t(`let x: ${esc("readonly")} T[];`);
t(`let x: ${esc("unique")} symbol;`);
t(`let x: ${esc("string")};`);
t(`let x: ${esc("any")};`);
t(`function f(x): x ${esc("is")} T {}`);
t(`function f(x): ${esc("asserts")} x {}`);
t(`type T = A extends ${esc("infer")} U ? U : 1;`);
t(`var ${esc("async")} = 1;`);
t(`var ${esc("let")} = 1;`);
t(`var ${esc("type")} = 1;`);
t(`${esc("type")};`);
t(`${esc("async")};`);
t(`x = { ${esc("get")}: 1 };`);
t(`x = { ${esc("get")} y() { return 1 } };`);
t(`${esc("using")} x = y;`);
t(`${esc("await")} using x = y;`);
t(`${esc("static")};`);
t(`var ${esc("static")} = 1;`);
t(`var ${esc("yield")} = 1;`);
t(`var ${esc("await")} = 1;`);
t(`${esc("async")} function f() {}`, "js");
t(`class C { ${esc("static")} x = 1 }`, "js");
t(`export ${esc("as")} namespace N;`);
t(`export * ${esc("as")} n from "a";`);
t(`export { a ${esc("as")} b };`);
t(`let x: A.${esc("type")};`);
t(`${esc("enum")} E {}`);
t(`class C { ${esc("static")} {} }`);
t(`({ ${esc("async")} m() {} });`);
t(`({ ${esc("async")}: 1 });`);
t(`x.${esc("async")};`);
t(`${esc("abstract")};`);

process.stdout.write(JSON.stringify(out, null, 0) + "\n");
