// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100302 1
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// `caller` and `arguments` of a function that is not running: null for a sloppy function, and a store to them does nothing; every other kind of function throws. By a read, by the getters of Function.prototype borrowed, by Reflect.get. A library reads `toss.caller` to say where a stack trace should start.
import "./kinds.cjs";

// FILE: kinds.cjs
function attempt(label, run) { try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); } }
function plain() { return 1; }
const arrow = () => 1;
const object = { method() { return 1; }, get got() { return 1; } };
class Box { method() {} static make() {} }
async function waits() {}
function* yields() {}
const bound = plain.bind(null);
const expression = function () {};
const kinds = { plain, arrow, method: object.method, getter: Object.getOwnPropertyDescriptor(object, "got").get, "class": Box, "class method": Box.prototype.method, "static method": Box.make, waits, yields, bound, expression, native: Math.max, "no function": {} };
const getCaller = Object.getOwnPropertyDescriptor(Function.prototype, "caller").get;
const getArguments = Object.getOwnPropertyDescriptor(Function.prototype, "arguments").get;
for (const [name, f] of Object.entries(kinds)) {
  attempt(name + ".caller", () => f.caller);
  attempt(name + ".arguments", () => f.arguments);
  attempt(name + ".caller = 1", () => { f.caller = 1; return "stored"; });
  attempt(name + ".arguments = 1", () => { f.arguments = 1; return "stored"; });
  attempt(name + ": the getters borrowed", () => [getCaller.call(f), getArguments.call(f)]);
  attempt(name + ": Reflect.get", () => [Reflect.get(Function.prototype, "caller", f), Reflect.get(Function.prototype, "arguments", f)]);
  attempt(name + ": own", () => [Object.hasOwn(f, "caller"), Object.hasOwn(f, "arguments"), "caller" in f]);
}
function ofArguments() { return [typeof arguments.callee, arguments.callee === ofArguments, arguments.caller, "caller" in arguments, Object.hasOwn(arguments, "callee")]; }
attempt("the arguments object of sloppy code", ofArguments);
function toss() { return new Error("failed", { cause: [toss.caller] }); }
attempt("read while it runs, the error is still made", () => toss().message);
module.exports = {};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
