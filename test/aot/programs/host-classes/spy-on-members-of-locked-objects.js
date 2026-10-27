// `spyOn` defines the property it is given on the object it is given. Where a locked object keeps that key, the spy is refused with a TypeError: an own method, a name it only inherits, an accessor, a constant, a static method, a function of Math. A name of the program's own on Array.prototype, an object that inherits from a locked one, and a built-in that is not locked can be spied on as in plain Bun.
import { spyOn } from "bun:test";

function attempt(label, target, name, call) {
  try {
    const spy = spyOn(target, name);
    call();
    console.log(label + ": spied, calls " + spy.mock.calls.length);
    spy.mockRestore();
  } catch (error) {
    console.log(label + ": throws " + error.name);
  }
}
const list = [];
const parameters = new URLSearchParams("a=1");

attempt("Array.prototype.push, its own method", Array.prototype, "push", () => [].push(1));
attempt("Array.prototype.hasOwnProperty, inherited", Array.prototype, "hasOwnProperty", () => [].hasOwnProperty("x"));
attempt("URLSearchParams.prototype.size, an accessor", URLSearchParams.prototype, "size", () => parameters.size);
attempt("Symbol.iterator, a constant", Symbol, "iterator", () => Symbol.iterator);
attempt("Promise.resolve, a static method", Promise, "resolve", () => Promise.resolve(1));
attempt("Map.prototype.get, a fixed member of an extensible prototype", Map.prototype, "get", () => new Map().get(1));
attempt("Array.prototype.added, a name of the program's own", Array.prototype, "added", () => [].added);
attempt("push of one array", list, "push", () => list.push(1));
attempt("get of one URLSearchParams", parameters, "get", () => parameters.get("a"));
attempt("Date.prototype.getTime", Date.prototype, "getTime", () => new Date(0).getTime());
attempt("Date.prototype.toString, a member that packages replace", Date.prototype, "toString", () => new Date(0).toString());
attempt("Error.prototype.toString, on a prototype that is not locked", Error.prototype, "toString", () => new Error("e").toString());
attempt("Math.max", Math, "max", () => Math.max(1, 2));
console.log(list.length, [].push(1), parameters.get("a"), Math.max(1, 2));
