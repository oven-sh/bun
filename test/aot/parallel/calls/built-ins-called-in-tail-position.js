// `return Math.floor(x)`, `return list.reduce(f, 0)`: the language makes these tail calls. What they answer, which frames an error lists, and that a chain of tail calls needs no stack.
"use strict";
function floor(x) { return Math.floor(x); }
function code(s) { return s.charCodeAt(1); }
function indexOf(list, x) { return list.indexOf(x); }
function keys(o) { return Object.keys(o); }
function text(o) { return JSON.stringify(o); }
function parse(s) { return JSON.parse(s); }
function has(map, key) { return map.has(key); }
function sum(list) { return list.reduce((s, v) => s + v, 0); }
function firstOver(list, limit) { return list.findIndex(v => v > limit); }
function doubled(list) { return list.map(v => v * 2); }
function each(list, f) { return list.forEach(f); }
function sorted(list, f) { return list.sort(f); }
function replaced(s, f) { return s.replaceAll("b", f); }

const framesOf = error => error.stack.split("\n").slice(1).map(line => /at (\S+)/.exec(line)?.[1]).filter(name => name && !name.includes("/") && !name.includes(":")).join(" < ");
function thrower() { throw new Error("thrown"); }
function attempt(name, f) {
  try {
    console.log(name, JSON.stringify(f()));
  } catch (error) {
    console.log(name, error.constructor.name, "|", framesOf(error));
  }
}

const list = [3, 1, 4, 1, 5, 9, 2, 6];
attempt("floor", () => floor(7.5));
attempt("code", () => code("abc"));
attempt("indexOf", () => indexOf(list, 5));
attempt("keys", () => keys({ a: 1, b: 2 }));
attempt("text", () => text({ a: [1, 2] }));
attempt("parse", () => parse('{"a":1}'));
attempt("has", () => has(new Map([["a", 1]]), "a"));
attempt("sum", () => sum(list));
attempt("firstOver", () => firstOver(list, 4));
attempt("doubled", () => doubled(list));
attempt("each", () => each(list, () => {}));
attempt("sorted", () => sorted(list.slice(), (a, b) => a - b));
attempt("replaced", () => replaced("abcb", () => "x"));

attempt("parse throws", () => parse("{"));
attempt("code throws", () => code(null));
attempt("sum throws", () => sum([]  .concat([1]).map(thrower)));
attempt("callback of reduce throws", () => [1, 2].reduce(thrower, 0));
attempt("each throws", () => each(list, thrower));
attempt("firstOver throws", () => list.findIndex(thrower));
attempt("sorted throws", () => sorted([2, 1], thrower));
attempt("replaced throws", () => replaced("abc", thrower));
attempt("no function", () => each(list, 1));

function countDown(n) { return n === 0 ? "done" : countDown.call(undefined, n - 1); }
function countDownByApply(n) { return n === 0 ? "done" : countDownByApply.apply(undefined, [n - 1]); }
function countDownByReflect(n) { return n === 0 ? "done" : Reflect.apply(countDownByReflect, undefined, [n - 1]); }
attempt("a chain through call", () => countDown(300000));
attempt("a chain through apply", () => countDownByApply(300000));
attempt("a chain through Reflect.apply", () => countDownByReflect(300000));
