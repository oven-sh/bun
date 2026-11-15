// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 57

// FILE: main.js
// Each module declares a top-level binding that nothing reads, and most of the declarations read a let, const or class before it is initialized.
const modules = [
  ["array-holds-itself", () => import("./array-holds-itself.js")],
  ["let-array-holds-itself", () => import("./let-array-holds-itself.js")],
  ["initializer-is-itself", () => import("./initializer-is-itself.js")],
  ["object-value-is-itself", () => import("./object-value-is-itself.js")],
  ["object-key-is-itself", () => import("./object-key-is-itself.js")],
  ["class-method-key-is-itself", () => import("./class-method-key-is-itself.js")],
  ["class-static-getter-key-is-itself", () => import("./class-static-getter-key-is-itself.js")],
  ["subclass-static-getter-key-is-itself", () => import("./subclass-static-getter-key-is-itself.js")],
  ["typeof-itself", () => import("./typeof-itself.js")],
  ["array-holds-later-const", () => import("./array-holds-later-const.js")],
  ["array-holds-later-let", () => import("./array-holds-later-let.js")],
  ["var-holds-later-let", () => import("./var-holds-later-let.js")],
  ["nested-literals-hold-later-const", () => import("./nested-literals-hold-later-const.js")],
  ["array-holds-later-subclass", () => import("./array-holds-later-subclass.js")],
  ["class-extends-later-subclass", () => import("./class-extends-later-subclass.js")],
  ["class-expression-extends-later-subclass", () => import("./class-expression-extends-later-subclass.js")],
  ["class-extends-itself", () => import("./class-extends-itself.js")],
  ["class-key-is-own-name", () => import("./class-key-is-own-name.js")],
  ["class-expression-extends-own-name", () => import("./class-expression-extends-own-name.js")],
  ["class-expression-static-key-is-own-name", () => import("./class-expression-static-key-is-own-name.js")],
  ["static-field-holds-later-const", () => import("./static-field-holds-later-const.js")],
  ["nested-class-key-in-static-field", () => import("./nested-class-key-in-static-field.js")],
  ["template-holds-later-const", () => import("./template-holds-later-const.js")],
  ["spread-of-array-literal", () => import("./spread-of-array-literal.js")],
  ["new-set", () => import("./new-set.js")],
  ["new-map", () => import("./new-map.js")],
  ["typeof-later-const", () => import("./typeof-later-const.js")],
  ["not-later-const", () => import("./not-later-const.js")],
  ["condition-is-later-const", () => import("./condition-is-later-const.js")],
  ["left-of-and", () => import("./left-of-and.js")],
  ["left-of-nullish", () => import("./left-of-nullish.js")],
  ["compared", () => import("./compared.js")],
  ["argument-of-annotated-call", () => import("./argument-of-annotated-call.js")],
  ["callee-of-annotated-call", () => import("./callee-of-annotated-call.js")],
  ["receiver-of-annotated-call", () => import("./receiver-of-annotated-call.js")],
  ["annotated-new-of-later-subclass", () => import("./annotated-new-of-later-subclass.js")],
  ["closure-called-in-initializer", () => import("./closure-called-in-initializer.js")],
  ["array-pattern-default", () => import("./array-pattern-default.js")],
  ["object-pattern-default", () => import("./object-pattern-default.js")],
  ["later-declarator-of-same-statement", () => import("./later-declarator-of-same-statement.js")],
  ["exported-array-holds-itself", () => import("./exported-array-holds-itself.js")],
  ["default-export-holds-later-const", () => import("./default-export-holds-later-const.js")],
  ["using-holds-later-const", () => import("./using-holds-later-const.js")],
  ["earlier-const", () => import("./earlier-const.js")],
  ["earlier-class", () => import("./earlier-class.js")],
  ["earlier-declarator-of-same-statement", () => import("./earlier-declarator-of-same-statement.js")],
  ["later-class-without-extends", () => import("./later-class-without-extends.js")],
  ["class-extends-later-class-without-extends", () => import("./class-extends-later-class-without-extends.js")],
  ["later-function", () => import("./later-function.js")],
  ["later-var", () => import("./later-var.js")],
  ["closure-reads-later-const", () => import("./closure-reads-later-const.js")],
  ["parameter-default-reads-later-const", () => import("./parameter-default-reads-later-const.js")],
  ["instance-field-reads-later-const", () => import("./instance-field-reads-later-const.js")],
  ["static-field-holds-own-name", () => import("./static-field-holds-own-name.js")],
  ["static-block-reads-own-name", () => import("./static-block-reads-own-name.js")],
  ["class-expression-static-field-holds-own-name", () => import("./class-expression-static-field-holds-own-name.js")],
];
for (const [name, load] of modules) {
  try {
    await load();
    console.log(name, "loaded");
  } catch (error) {
    console.log(name, error.name);
  }
}

// FILE: annotated-new-of-later-subclass.js
const w = /* @__PURE__ */ new C();
class C extends Object {}

// FILE: argument-of-annotated-call.js
function f() {}
const w = /* @__PURE__ */ f(v);
const v = 1;

// FILE: array-holds-itself.js
const v = [v];

// FILE: array-holds-later-const.js
const w = [v];
const v = 1;

// FILE: array-holds-later-let.js
const w = [v];
let v = 1;

// FILE: array-holds-later-subclass.js
const w = [C];
class C extends Object {}

// FILE: array-pattern-default.js
const [a = b, b] = [];

// FILE: callee-of-annotated-call.js
const w = /* @__PURE__ */ f();
const f = () => 1;

// FILE: class-expression-extends-later-subclass.js
const w = class extends C {};
class C extends Object {}

// FILE: class-expression-extends-own-name.js
const w = class N extends N {};

// FILE: class-expression-static-field-holds-own-name.js
const w = class N { static x = [N]; };

// FILE: class-expression-static-key-is-own-name.js
const w = class N { static [N] = 1; };

// FILE: class-extends-itself.js
class A extends A {}

// FILE: class-extends-later-class-without-extends.js
class A extends B {}
class B {}

// FILE: class-extends-later-subclass.js
class A extends B {}
class B extends Object {}

// FILE: class-key-is-own-name.js
class A { [A]() {} }

// FILE: class-method-key-is-itself.js
const v = class { [v]() {} };

// FILE: class-static-getter-key-is-itself.js
const v = class { static get [v]() { return 1; } };

// FILE: closure-called-in-initializer.js
const v = (() => v)();

// FILE: closure-reads-later-const.js
const w = () => v;
const v = 1;

// FILE: compared.js
const w = v === 1;
const v = 1;

// FILE: condition-is-later-const.js
const w = v ? 1 : 2;
const v = 1;

// FILE: default-export-holds-later-const.js
export default [v];
const v = {};

// FILE: earlier-class.js
class C extends Object {}
const w = [C];

// FILE: earlier-const.js
const v = 1;
const w = [v];

// FILE: earlier-declarator-of-same-statement.js
const a = 1, b = [a];

// FILE: exported-array-holds-itself.js
export const v = [v];

// FILE: initializer-is-itself.js
const v = v;

// FILE: instance-field-reads-later-const.js
const w = class { a = v; b() { return v; } };
const v = 1;

// FILE: later-class-without-extends.js
const w = [C];
class C {}

// FILE: later-declarator-of-same-statement.js
const a = [b], b = 1;

// FILE: later-function.js
const w = [f];
function f() {}

// FILE: later-var.js
const w = [x];
var x = 1;

// FILE: left-of-and.js
const w = v && 1;
const v = 1;

// FILE: left-of-nullish.js
const w = v ?? 1;
const v = 1;

// FILE: let-array-holds-itself.js
let v = [v];

// FILE: nested-class-key-in-static-field.js
const w = class { static a = class { [v]() {} }; };
const v = 1;

// FILE: nested-literals-hold-later-const.js
const w = { a: [{ b: [v] }] };
const v = 1;

// FILE: new-map.js
const w = new Map([[v, 1]]);
const v = 1;

// FILE: new-set.js
const w = new Set([v]);
const v = 1;

// FILE: not-later-const.js
const w = !v;
const v = 1;

// FILE: object-key-is-itself.js
const v = { [v]: 1 };

// FILE: object-pattern-default.js
const { a = b, b } = {};

// FILE: object-value-is-itself.js
const v = { a: v };

// FILE: parameter-default-reads-later-const.js
const w = function (a = v) {};
const v = 1;

// FILE: receiver-of-annotated-call.js
const w = /* @__PURE__ */ v.a();
const v = { a() {} };

// FILE: spread-of-array-literal.js
const w = [...[v]];
const v = 1;

// FILE: static-block-reads-own-name.js
class A { static { [A]; } }

// FILE: static-field-holds-later-const.js
class A { static x = [v]; }
const v = {};

// FILE: static-field-holds-own-name.js
class A { static x = [A]; }

// FILE: subclass-static-getter-key-is-itself.js
const v = class extends Array { static get [v]() { return 1; } };

// FILE: template-holds-later-const.js
const w = `${v}`;
const v = "a";

// FILE: typeof-itself.js
const v = typeof v;

// FILE: typeof-later-const.js
const w = typeof v;
const v = 1;

// FILE: using-holds-later-const.js
using w = null, x = [y];
const y = 1;

// FILE: var-holds-later-let.js
var w = [v];
let v = 1;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
