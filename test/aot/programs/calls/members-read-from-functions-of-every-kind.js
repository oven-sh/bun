var out = [];
class A { static call() { return "static call"; } static apply() { return "static apply"; } static get bind() { return function () { return "static bind"; }; } }
out.push(A.call(), A.apply(), A.bind());
class B extends A {}
out.push(B.call(), B.apply(), B.bind());
class C { static call = function () { return "static field"; }; }
out.push(C.call());
function F() {}
F.call = function () { return "own"; };
out.push(F.call());
function G() {}
Object.defineProperty(G, "apply", { value: function () { return "defined"; } });
out.push(G.apply());
function H() {}
Object.assign(H, { bind: function () { return "assigned"; } });
out.push(H.bind());
function K() {}
Object.setPrototypeOf(K, { call: function () { return "prototype"; } });
out.push(K.call());
async function asyncFunction() {}
function* generatorFunction() {}
async function* asyncGeneratorFunction() {}
function plain() {}
var arrow = () => 1;
out.push(asyncFunction.constructor === Function, generatorFunction.constructor === Function, asyncGeneratorFunction.constructor === Function, plain.constructor === Function, arrow.constructor === Function);
out.push(typeof asyncFunction.call, typeof generatorFunction.apply, Object.prototype.toString.call(asyncFunction), asyncFunction[Symbol.toStringTag], plain[Symbol.toStringTag]);
var holder = { method() { return 1; }, get accessor() { return 2; } };
out.push(holder.method.call(holder), typeof holder.method.bind, plain.hasOwnProperty("call"), plain.toString === Function.prototype.toString, plain.isPrototypeOf === Object.prototype.isPrototypeOf);
function named() {}
var key = "ca" + "ll";
named[key] = function () { return "computed"; };
out.push(named.call());
console.log(out.join(" | "));
