// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="late"

// FILE: main.ts
// Typed names of every kind hold what require answers.
import { exported, viaClosure, viaVar, viaLet, viaCommonJs, viaEquals, viaClass, viaPattern } from "./user.ts";
console.log(exported.f(), viaClosure(), viaVar(), viaLet(), viaCommonJs(), viaEquals(), viaClass(), viaPattern());
function late() {
  return require("./m.ts").f() + require("./c.cjs").g();
}
console.log(late());

// FILE: c.cjs
exports.g = function () {
  return 2;
};

// FILE: m.ts
export function f() {
  return 1;
}

// FILE: user.ts
import equals = require("./m.ts");
type M = { f: typeof import("./m.ts").f };
export const exported: M = require("./m.ts");
function outer() {
  const inner: M = require("./m.ts");
  return () => inner.f();
}
export const viaClosure = outer();
var held: M = require("./m.ts");
export function viaVar() {
  return held.f();
}
let changing: typeof import("./m.ts") = require("./m.ts");
export function viaLet() {
  return changing.f();
}
const old: { g(): number } = require("./c.cjs");
export function viaCommonJs() {
  return old.g();
}
export function viaEquals() {
  return equals.f();
}
class Keeps {
  static kept: M = require("./m.ts");
  own: M = require("./m.ts");
}
export function viaClass() {
  return Keeps.kept.f() + new Keeps().own.f();
}
const { f: taken }: M = require("./m.ts");
export function viaPattern() {
  return taken();
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
