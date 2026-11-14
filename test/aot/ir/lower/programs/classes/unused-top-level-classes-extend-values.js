// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 70

// FILE: main.js
// Each module defines a class at its top level that nothing uses. Defining a class throws a TypeError unless it extends null or a constructor whose prototype property is an object or null.
const modules = [
  ["object-literal", () => import("./object-literal.js")],
  ["array-literal", () => import("./array-literal.js")],
  ["number", () => import("./number.js")],
  ["string", () => import("./string.js")],
  ["boolean", () => import("./boolean.js")],
  ["undefined", () => import("./undefined.js")],
  ["void", () => import("./void.js")],
  ["bigint", () => import("./bigint.js")],
  ["symbol", () => import("./symbol.js")],
  ["regular-expression", () => import("./regular-expression.js")],
  ["template", () => import("./template.js")],
  ["null", () => import("./null.js")],
  ["arrow-function", () => import("./arrow-function.js")],
  ["async-function", () => import("./async-function.js")],
  ["generator", () => import("./generator.js")],
  ["method", () => import("./method.js")],
  ["function-expression", () => import("./function-expression.js")],
  ["class-expression", () => import("./class-expression.js")],
  ["class-expression-that-extends-an-object", () => import("./class-expression-that-extends-an-object.js")],
  ["const-object", () => import("./const-object.js")],
  ["const-arrow-function", () => import("./const-arrow-function.js")],
  ["const-class", () => import("./const-class.js")],
  ["let-without-a-value", () => import("./let-without-a-value.js")],
  ["var-assigned-later", () => import("./var-assigned-later.js")],
  ["var-assigned-in-a-branch-not-taken", () => import("./var-assigned-in-a-branch-not-taken.js")],
  ["var-assigned-twice", () => import("./var-assigned-twice.js")],
  ["var-class", () => import("./var-class.js")],
  ["let-reassigned", () => import("./let-reassigned.js")],
  ["let-reassigned-by-a-function", () => import("./let-reassigned-by-a-function.js")],
  ["let-reassigned-later", () => import("./let-reassigned-later.js")],
  ["class-reassigned", () => import("./class-reassigned.js")],
  ["class-declaration", () => import("./class-declaration.js")],
  ["class-declared-later", () => import("./class-declared-later.js")],
  ["chain-that-starts-at-an-object", () => import("./chain-that-starts-at-an-object.js")],
  ["function-declaration", () => import("./function-declaration.js")],
  ["function-with-a-number-as-prototype", () => import("./function-with-a-number-as-prototype.js")],
  ["function-with-null-as-prototype", () => import("./function-with-null-as-prototype.js")],
  ["function-whose-prototype-an-alias-replaces", () => import("./function-whose-prototype-an-alias-replaces.js")],
  ["function-expression-with-a-number-as-prototype", () => import("./function-expression-with-a-number-as-prototype.js")],
  ["async-function-declaration", () => import("./async-function-declaration.js")],
  ["generator-declaration", () => import("./generator-declaration.js")],
  ["proxy-of-a-class", () => import("./proxy-of-a-class.js")],
  ["conditional-with-an-object", () => import("./conditional-with-an-object.js")],
  ["conditional-of-two-classes", () => import("./conditional-of-two-classes.js")],
  ["logical-or-with-an-object", () => import("./logical-or-with-an-object.js")],
  ["logical-and-with-an-object", () => import("./logical-and-with-an-object.js")],
  ["comma-that-ends-in-an-object", () => import("./comma-that-ends-in-an-object.js")],
  ["comma-that-ends-in-a-class", () => import("./comma-that-ends-in-a-class.js")],
  ["math", () => import("./math.js")],
  ["json", () => import("./json.js")],
  ["parse-int", () => import("./parse-int.js")],
  ["proxy", () => import("./proxy.js")],
  ["function-prototype", () => import("./function-prototype.js")],
  ["array-prototype-map", () => import("./array-prototype-map.js")],
  ["global-this", () => import("./global-this.js")],
  ["process", () => import("./process.js")],
  ["object", () => import("./object.js")],
  ["array", () => import("./array.js")],
  ["error", () => import("./error.js")],
  ["type-error", () => import("./type-error.js")],
  ["map", () => import("./map.js")],
  ["promise", () => import("./promise.js")],
  ["uint8-array", () => import("./uint8-array.js")],
  ["buffer", () => import("./buffer.js")],
  ["event-target", () => import("./event-target.js")],
  ["response", () => import("./response.js")],
  ["intl-collator", () => import("./intl-collator.js")],
  ["statements-around-the-class", () => import("./statements-around-the-class.js")],
  ["members", () => import("./members.js")],
];
for (const [name, load] of modules) {
  try {
    await load();
    console.log(name, "loaded");
  } catch (error) {
    console.log(name, error.name, error.message);
  }
}

// FILE: array-literal.js
class Unused extends [] {}

// FILE: array-prototype-map.js
class Unused extends Array.prototype.map {}

// FILE: array.js
class Unused extends Array {}

// FILE: arrow-function.js
class Unused extends (() => {}) {}

// FILE: async-function-declaration.js
async function Base() {}
class Unused extends Base {}

// FILE: async-function.js
class Unused extends (async function () {}) {}

// FILE: bigint.js
class Unused extends 1n {}

// FILE: boolean.js
class Unused extends true {}

// FILE: buffer.js
class Unused extends Buffer {}

// FILE: chain-that-starts-at-an-object.js
const base = {};
class Middle extends base {}
class Unused extends Middle {}

// FILE: class-declaration.js
class Base {}
class Unused extends Base {}

// FILE: class-declared-later.js
class Unused extends Base {}
class Base {}

// FILE: class-expression-that-extends-an-object.js
class Unused extends class extends {} {} {}

// FILE: class-expression.js
class Unused extends class {} {}

// FILE: class-reassigned.js
class Base {}
Base = 5;
class Unused extends Base {}

// FILE: comma-that-ends-in-a-class.js
class Base {}
class Unused extends ({}, Base) {}

// FILE: comma-that-ends-in-an-object.js
class Base {}
class Unused extends (Base, {}) {}

// FILE: conditional-of-two-classes.js
class First {}
class Second {}
class Unused extends (globalThis.nothing ? First : Second) {}

// FILE: conditional-with-an-object.js
class Base {}
class Unused extends (globalThis.nothing ? Base : {}) {}

// FILE: const-arrow-function.js
const base = () => {};
class Unused extends base {}

// FILE: const-class.js
const base = class {};
class Unused extends base {}

// FILE: const-object.js
const base = {};
class Unused extends base {}

// FILE: error.js
class Unused extends Error {}

// FILE: event-target.js
class Unused extends EventTarget {}

// FILE: function-declaration.js
function Base() {}
class Unused extends Base {}

// FILE: function-expression-with-a-number-as-prototype.js
const Base = function () {};
Base.prototype = 5;
class Unused extends Base {}

// FILE: function-expression.js
class Unused extends function () {} {}

// FILE: function-prototype.js
class Unused extends Function.prototype {}

// FILE: function-whose-prototype-an-alias-replaces.js
function Base() {}
const alias = Base;
alias.prototype = "text";
class Unused extends Base {}

// FILE: function-with-a-number-as-prototype.js
function Base() {}
Base.prototype = 5;
class Unused extends Base {}

// FILE: function-with-null-as-prototype.js
function Base() {}
Base.prototype = null;
class Unused extends Base {}

// FILE: generator-declaration.js
function* Base() {}
class Unused extends Base {}

// FILE: generator.js
class Unused extends (function* () {}) {}

// FILE: global-this.js
class Unused extends globalThis {}

// FILE: intl-collator.js
class Unused extends Intl.Collator {}

// FILE: json.js
class Unused extends JSON {}

// FILE: let-reassigned-by-a-function.js
let base = class {};
function replace() {
  base = {};
}
replace();
class Unused extends base {}

// FILE: let-reassigned-later.js
let base = class {};
class Unused extends base {}
base = {};

// FILE: let-reassigned.js
let base = class {};
base = {};
class Unused extends base {}

// FILE: let-without-a-value.js
let base;
class Unused extends base {}

// FILE: logical-and-with-an-object.js
class Base {}
class Unused extends (Base && {}) {}

// FILE: logical-or-with-an-object.js
class Unused extends (globalThis.nothing || {}) {}

// FILE: map.js
class Unused extends Map {}

// FILE: math.js
class Unused extends Math {}

// FILE: members.js
class Unused extends {} {
  static count = 1;
  field = 2;
  constructor() {
    super();
  }
  method() {
    return this.field;
  }
  static create() {
    return new Unused();
  }
}

// FILE: method.js
class Unused extends { method() {} }.method {}

// FILE: null.js
class Unused extends null {}

// FILE: number.js
class Unused extends 5 {}

// FILE: object-literal.js
class Unused extends {} {}

// FILE: object.js
class Unused extends Object {}

// FILE: parse-int.js
class Unused extends parseInt {}

// FILE: process.js
class Unused extends process {}

// FILE: promise.js
class Unused extends Promise {}

// FILE: proxy-of-a-class.js
const Base = new Proxy(class {}, {
  get(target, key) {
    console.log("get", String(key));
    return target[key];
  },
});
class Unused extends Base {}

// FILE: proxy.js
class Unused extends Proxy {}

// FILE: regular-expression.js
class Unused extends /x/ {}

// FILE: response.js
class Unused extends Response {}

// FILE: statements-around-the-class.js
console.log("before the class");
class Unused extends {} {}
console.log("after the class");

// FILE: string.js
class Unused extends "text" {}

// FILE: symbol.js
class Unused extends Symbol.iterator {}

// FILE: template.js
class Unused extends `text` {}

// FILE: type-error.js
class Unused extends TypeError {}

// FILE: uint8-array.js
class Unused extends Uint8Array {}

// FILE: undefined.js
class Unused extends undefined {}

// FILE: var-assigned-in-a-branch-not-taken.js
if (globalThis.nothing) {
  var base = class {};
}
class Unused extends base {}

// FILE: var-assigned-later.js
class Unused extends base {}
var base = class {};

// FILE: var-assigned-twice.js
var base = class {};
var base = {};
class Unused extends base {}

// FILE: var-class.js
var Base = class {};
var Unused = class extends Base {};

// FILE: void.js
class Unused extends (void 0) {}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
