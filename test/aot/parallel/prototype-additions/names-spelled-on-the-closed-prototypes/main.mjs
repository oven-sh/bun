// Function.prototype, Promise.prototype and RegExp.prototype take a new name where a file spells it. Every program out of dart2js starts with `Function.prototype.call$0 = ..`.
import helper from "./helper.cjs";
function plain() {}
class Shelf { method() {} }
const literal = { own: 1 }, list = [1], promise = Promise.resolve(1), pattern = /x/;
const read = (value, which) => (which === 0 ? value.call$0 : value.fromHelper$0);
const namesIn = value => { const names = []; for (const name in value) names.push(name); return names.join(); };
const show = when =>
  console.log(when, typeof plain.call$0, typeof read(plain, 0), "call$0" in Function.prototype, "call$0" in plain, Object.hasOwn(Function.prototype, "call$0"), "|",
    literal.call$0, namesIn(literal), namesIn(list), namesIn(plain), Object.keys(plain).join(), "|",
    typeof promise.tap$, typeof pattern.twice$, typeof read(plain, 1), Object.getOwnPropertyNames(Function.prototype).filter(name => name.includes("$")).join());
show("before");
Function.prototype.call$0 = function () { return "added:" + typeof this; };
Promise.prototype.tap$ = function () { return this; };
RegExp.prototype.twice$ = function () { return this.source + this.source; };
Object.defineProperty(Function.prototype, "hidden$", { value: 7, configurable: true });
helper.add();
show("after");
console.log("calls", plain.call$0(), Shelf.call$0(), (() => 1).call$0(), pattern.twice$(), promise.tap$() === promise, plain.fromHelper$0(), plain.hidden$, Object.isExtensible(Function.prototype));
delete Function.prototype.call$0;
delete Promise.prototype.tap$;
delete RegExp.prototype.twice$;
delete Function.prototype.hidden$;
helper.remove();
show("removed");
