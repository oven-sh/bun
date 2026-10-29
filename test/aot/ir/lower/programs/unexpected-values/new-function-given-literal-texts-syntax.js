// RUN: lower
// OPTIONS: builtin-modules

// FILE: new-function-given-literal-texts-syntax.js
// New function is given literal texts that are syntax errors.
function attempt(make) {
  try {
    return typeof make();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("let a; let a;", attempt(() => new Function("let a; let a;")));
console.log("'use strict'; with (a) {}", attempt(() => new Function("'use strict'; with (a) {}")));
console.log("(a = 1) => { 'use strict'; }", attempt(() => new Function("(a = 1) => { 'use strict'; }")));
console.log("'use strict'; function f(a, a) {}", attempt(() => new Function("'use strict'; function f(a, a) {}")));
console.log("break;", attempt(() => new Function("break;")));
console.log("continue;", attempt(() => new Function("continue;")));
console.log("'use strict'; var yield;", attempt(() => new Function("'use strict'; var yield;")));
console.log("async (x = await 1) => 1", attempt(() => new Function("async (x = await 1) => 1")));
console.log("(async function () { (x = await 1) => 1 })", attempt(() => new Function("(async function () { (x = await 1) => 1 })")));
console.log("class A { constructor() {} constructor() {} }", attempt(() => new Function("class A { constructor() {} constructor() {} }")));
console.log("({ a: 1 } = 1)", attempt(() => new Function("({ a: 1 } = 1)")));
console.log("super()", attempt(() => new Function("super()")));
console.log("super.x", attempt(() => new Function("super.x")));
console.log("for (let let of x) {}", attempt(() => new Function("for (let let of x) {}")));
console.log("label: label: ;", attempt(() => new Function("label: label: ;")));
console.log("/(/", attempt(() => new Function("/(/")));
console.log("1++", attempt(() => new Function("1++")));
console.log("'use strict'; 010", attempt(() => new Function("'use strict'; 010")));
console.log("'use strict'; delete x", attempt(() => new Function("'use strict'; delete x")));
console.log("({ __proto__: 1, __proto__: 2 })", attempt(() => new Function("({ __proto__: 1, __proto__: 2 })")));
console.log("#x in y", attempt(() => new Function("#x in y")));
console.log("import.meta", attempt(() => new Function("import.meta")));
console.log("(function* () { (x = yield) => 1 })", attempt(() => new Function("(function* () { (x = yield) => 1 })")));
console.log("function* g(x = yield) {}", attempt(() => new Function("function* g(x = yield) {}")));
console.log("async function f(x = await 1) {}", attempt(() => new Function("async function f(x = await 1) {}")));
console.log("class A extends B { constructor() { function f() { super() } } }", attempt(() => new Function("class A extends B { constructor() { function f() { super() } } }")));
console.log("let [a, a] = []", attempt(() => new Function("let [a, a] = []")));
console.log("const a;", attempt(() => new Function("const a;")));
console.log("for (const a of [], []) {}", attempt(() => new Function("for (const a of [], []) {}")));
console.log("if (1) class A {}", attempt(() => new Function("if (1) class A {}")));
console.log("while (1) function f() {}", attempt(() => new Function("while (1) function f() {}")));
console.log("'use strict'; if (1) function f() {}", attempt(() => new Function("'use strict'; if (1) function f() {}")));
console.log("a?.b = 1", attempt(() => new Function("a?.b = 1")));
console.log("new a?.b()", attempt(() => new Function("new a?.b()")));
console.log("a?.`x`", attempt(() => new Function("a?.`x`")));
console.log("({ a = 1 })", attempt(() => new Function("({ a = 1 })")));
console.log("(a, b) = 1", attempt(() => new Function("(a, b) = 1")));
console.log("`${}`", attempt(() => new Function("`${}`")));
console.log("'\\u{110000}'", attempt(() => new Function("'\\u{110000}'")));
console.log("/a/gg", attempt(() => new Function("/a/gg")));
console.log("/(?<n>a)(?<n>b)/", attempt(() => new Function("/(?<n>a)(?<n>b)/")));
console.log("class A { #a; #a }", attempt(() => new Function("class A { #a; #a }")));
console.log("class A { m() { this.#b } }", attempt(() => new Function("class A { m() { this.#b } }")));
console.log("try {} catch ([a, a]) {}", attempt(() => new Function("try {} catch ([a, a]) {}")));
console.log("try {} catch (e) { let e }", attempt(() => new Function("try {} catch (e) { let e }")));
console.log("function f() { 'use strict'; arguments = 1 }", attempt(() => new Function("function f() { 'use strict'; arguments = 1 }")));
console.log("'use strict'; eval = 1", attempt(() => new Function("'use strict'; eval = 1")));
console.log("x = { get a(b) {} }", attempt(() => new Function("x = { get a(b) {} }")));
console.log("x = { set a() {} }", attempt(() => new Function("x = { set a() {} }")));
console.log("(...a, b) => 1", attempt(() => new Function("(...a, b) => 1")));
console.log("function f(...a = []) {}", attempt(() => new Function("function f(...a = []) {}")));
console.log("0++", attempt(() => new Function("0++")));
console.log("for (let of x) {}", attempt(() => new Function("for (let of x) {}")));
console.log("for (async of x) {}", attempt(() => new Function("for (async of x) {}")));
console.log("let let = 1", attempt(() => new Function("let let = 1")));
console.log("class A { static prototype() {} }", attempt(() => new Function("class A { static prototype() {} }")));
console.log("class A { get constructor() {} }", attempt(() => new Function("class A { get constructor() {} }")));
console.log("export {}", attempt(() => new Function("export {}")));
console.log("import 'a'", attempt(() => new Function("import 'a'")));
console.log("a => {} ()", attempt(() => new Function("a => {} ()")));
console.log("() => {} || 1", attempt(() => new Function("() => {} || 1")));
console.log("-1 ** 2", attempt(() => new Function("-1 ** 2")));
console.log("a ?? b || c", attempt(() => new Function("a ?? b || c")));
console.log("1_", attempt(() => new Function("1_")));
console.log("0_1", attempt(() => new Function("0_1")));
console.log("1n.5", attempt(() => new Function("1n.5")));
console.log("\"\\08\"; 'use strict'", attempt(() => new Function("\"\\08\"; 'use strict'")));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: attempt
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="make"
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = PropGet v3 key="constructor"
// CHECK-NEXT: v5 = PropGet v4 key="name"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
