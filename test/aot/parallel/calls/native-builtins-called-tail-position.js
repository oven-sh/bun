// `return stack.pop()`, `return list.join(",")`: tail calls of native methods, on lists that are known to be lists and of which nothing proves that they are as they were made.
"use strict";
function pop(list) { return list.pop(); }
function shift(list) { return list.shift(); }
function push(list, x) { return list.push(x); }
function unshift(list, x) { return list.unshift(x); }
function includes(list, x) { return list.includes(x); }
function indexOf(list, x) { return list.indexOf(x); }
function lastIndexOf(list, x) { return list.lastIndexOf(x); }
function at(list, i) { return list.at(i); }
function join(list, s) { return list.join(s); }
function slice(list) { return list.slice(); }
function concat(list, more) { return list.concat(more); }
function reverse(list) { return list.reverse(); }
function fill(list, x) { return list.fill(x); }
function splice(list) { return list.splice(1, 1); }
function text(list) { return list.toString(); }
function made(n) { return Array(n); }

const framesOf = error => error.stack.split("\n").slice(1).map(line => /at (\S+)/.exec(line)?.[1]).filter(name => name && !name.includes("/") && !name.includes(":")).join(" < ");
function attempt(name, f) {
  try {
    console.log(name, JSON.stringify(f()));
  } catch (error) {
    console.log(name, error.constructor.name, "|", framesOf(error));
  }
}
function thrower() { throw new Error("thrown"); }

const kinds = {
  plain: () => [1, 2, 3, 4],
  frozen: () => Object.freeze([1, 2, 3, 4]),
  sealed: () => Object.seal([1, 2, 3, 4]),
  holes: () => [1, , 3, , ],
  sparse: () => { const list = [1, 2]; list[100000] = 3; list.length = 4; return list; },
  getter: () => Object.defineProperty([1, 2, 3, 4], 2, { get: () => 30, configurable: true }),
  "getter that throws": () => Object.defineProperty([1, 2, 3, 4], 2, { get: thrower, configurable: true }),
  "own method": () => Object.assign([1, 2, 3, 4], { pop: () => "own pop", join: () => "own join", includes: () => "own includes", slice: thrower }),
  "other prototype": () => Object.setPrototypeOf([1, 2, 3, 4], { __proto__: Array.prototype, at: () => "other at", concat: () => "other concat", indexOf: thrower }),
  "fixed length": () => Object.defineProperty([1, 2, 3, 4], "length", { writable: false }),
  texts: () => ["a", "b", "c", "d"],
  fractions: () => [1.5, 2.5, NaN, 4.5],
};

for (let round = 0; round < 3; round++) {
  for (const [kind, make] of Object.entries(kinds)) {
    const show = round === 2 ? attempt : (name, f) => { try { f(); } catch { } };
    show(kind + " pop", () => { const list = make(); return [pop(list), list.length]; });
    show(kind + " shift", () => { const list = make(); return [shift(list), list.length]; });
    show(kind + " push", () => { const list = make(); return [push(list, 9), list.length]; });
    show(kind + " unshift", () => { const list = make(); return [unshift(list, 9), list.length]; });
    show(kind + " includes", () => [includes(make(), 3), includes(make(), undefined), includes(make(), NaN), includes(make(), "c")]);
    show(kind + " indexOf", () => [indexOf(make(), 3), indexOf(make(), undefined), indexOf(make(), NaN), indexOf(make(), "c")]);
    show(kind + " lastIndexOf", () => [lastIndexOf(make(), 3), lastIndexOf(make(), 30)]);
    show(kind + " at", () => [at(make(), -1), at(make(), 2), at(make(), 9)]);
    show(kind + " join", () => join(make(), "-"));
    show(kind + " slice", () => slice(make()));
    show(kind + " concat", () => [concat(make(), make()), concat(make(), 7)]);
    show(kind + " reverse", () => reverse(make()));
    show(kind + " fill", () => fill(make(), 0));
    show(kind + " splice", () => { const list = make(); return [splice(list), list]; });
    show(kind + " text", () => text(make()));
  }
}
attempt("made", () => [made(3).length, made(0).length, made("a")]);
attempt("made throws", () => made(-1));
