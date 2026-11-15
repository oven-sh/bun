// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 6
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="Point3"

// FILE: main.ts
// Export equals is imported by default without es module interop.
import Point from "./class.cjs";
import plusOne from "./function.cjs";
import marked, { other } from "./marked.cjs";
import * as markedNamespace from "./marked.cjs";
import answer from "./number.cjs";
import settings from "./object.cjs";
import * as settingsNamespace from "./object.cjs";
import wrong from "./wrong.cjs";
import required = require("./function.cjs");
import RequiredPoint = require("./class.cjs");
import requiredMarked = require("./marked.cjs");

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

attempt("a function", () => [typeof plusOne, plusOne(1), plusOne.version, plusOne === required, required(2)]);
attempt("a class", () => {
  const p = new Point(1, 2);
  return [typeof Point, p.sum(), p instanceof RequiredPoint, Point === RequiredPoint, Object.keys(p).join()];
});
attempt("a subclass", () => {
  class Point3 extends Point {
    z = 3;
  }
  const p = new Point3(1, 2);
  return [p.sum() + p.z, Object.keys(p).join()];
});
attempt("an object", () => [typeof settings, settings.limit + 1, settings.name, settings.default, Object.keys(settings).join()]);
attempt("an object as a namespace", () => [settingsNamespace.limit + 1, settingsNamespace.name, typeof settingsNamespace.default, Object.keys(settingsNamespace).sort().join()]);
attempt("a file marked as an es module", () => [typeof marked, typeof other, other + 1, Object.keys(markedNamespace).sort().join(), typeof markedNamespace.default]);
attempt("a file marked as an es module, called", () => marked());
attempt("a file marked as an es module, required", () => [typeof requiredMarked, typeof requiredMarked.default, requiredMarked.other, requiredMarked.default()]);
attempt("a number", () => [typeof answer, answer + 1]);
attempt("a declaration that is wrong", () => [typeof wrong, Object.keys(wrong).join()]);
attempt("a declaration that is wrong, called", () => wrong(1) + 1);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + new Point(i, 1).sum() + settings.limit + answer;
console.log("2000 rounds: " + warm);

// FILE: class.cjs
module.exports = class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
};

// FILE: class.d.cts
declare class Point {
  x: number;
  y: number;
  constructor(x: number, y: number);
  sum(): number;
}
export = Point;

// FILE: function.cjs
function plusOne(n) {
  return n + 1;
}
plusOne.version = "1";
module.exports = plusOne;

// FILE: function.d.cts
declare function plusOne(n: number): number;
declare namespace plusOne {
  const version: string;
}
export = plusOne;

// FILE: marked.cjs
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = function marked() {
  return "the default of a marked file";
};
exports.other = 5;

// FILE: marked.d.cts
export default function marked(): string;
export declare const other: number;

// FILE: number.cjs
module.exports = 42;

// FILE: number.d.cts
declare const answer: number;
export = answer;

// FILE: object.cjs
module.exports = { limit: 10, name: "object", default: "a member called default" };

// FILE: object.d.cts
declare const settings: { limit: number; name: string; default: string };
export = settings;

// FILE: wrong.cjs
exports.plusOne = n => n + "!";

// FILE: wrong.d.cts
declare function plusOne(n: number): number;
export = plusOne;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "esModuleInterop": false, "ignoreDeprecations": "6.0", "allowSyntheticDefaultImports": true }, "files": [] }
