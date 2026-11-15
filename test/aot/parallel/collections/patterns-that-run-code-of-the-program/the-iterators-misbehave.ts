const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
function two(items: any) { const [a, b] = items; return [a, b]; }
const from = (iterator: unknown) => ({ [Symbol.iterator]() { log.push("open"); return iterator; } });
const cases: [string, () => unknown][] = [
  ["next throws", () => from({ next() { throw new Error("from next"); }, return() { log.push("return"); return {}; } })],
  ["the second next throws", () => { let at = 0; return from({ next() { if (at++) throw new Error("from the second"); return { done: false, value: 1 }; }, return() { log.push("return"); return {}; } }); }],
  ["done throws", () => from({ next() { return { get done() { throw new Error("from done"); }, value: 1 }; }, return() { log.push("return"); return {}; } })],
  ["value throws", () => from({ next() { return { done: false, get value() { throw new Error("from value"); } }; }, return() { log.push("return"); return {}; } })],
  ["return throws", () => from({ next() { return { done: false, value: 1 }; }, return() { throw new Error("from return"); } })],
  ["return gives no object", () => from({ next() { return { done: false, value: 1 }; }, return() { return 5; } })],
  ["return is no function", () => from({ next() { return { done: false, value: 1 }; }, return: 5 })],
  ["return is null", () => from({ next() { return { done: false, value: 1 }; }, return: null })],
  ["a getter for return", () => from({ next() { return { done: false, value: 1 }; }, get return() { log.push("return is read"); return undefined; } })],
  ["next gives no object", () => from({ next() { return 5; }, return() { log.push("return"); return {}; } })],
  ["next gives undefined", () => from({ next() {}, return() { log.push("return"); return {}; } })],
  ["next is no function", () => from({ next: 5 })], ["there is no next", () => from({})],
  ["a getter for next", () => from({ get next() { log.push("next is read"); return () => ({ done: true }); } })],
  ["the iterator is no object", () => from(5)], ["the iterator is undefined", () => from(undefined)], ["the iterator is null", () => from(null)], ["the iterator is a function", () => from(Object.assign(() => {}, { next: () => ({ done: true }) }))],
  ["the method is no function", () => ({ [Symbol.iterator]: 5 })], ["the method is undefined", () => ({ [Symbol.iterator]: undefined })], ["the method is null", () => ({ [Symbol.iterator]: null })], ["there is no method", () => ({})], ["the method throws", () => ({ [Symbol.iterator]() { throw new Error("from the method"); } })], ["a getter for the method throws", () => ({ get [Symbol.iterator]() { throw new Error("from the getter"); } })],
  ["done is truthy", () => from({ next() { return { done: "yes", value: 1 }; }, return() { log.push("return"); return {}; } })], ["done is 0", () => { let at = 0; return from({ next() { return { done: at++ > 5 ? 1 : 0, value: at }; }, return() { log.push("return"); return {}; } }); }],
  ["the result is a function", () => from({ next() { return Object.assign(() => {}, { done: false, value: "of a function" }); } })], ["the result inherits", () => from({ next() { return Object.create({ done: false, value: "inherited" }); } })], ["the result is a Proxy", () => from({ next() { return new Proxy({ done: false, value: 1 }, { get(target, key) { log.push("get " + String(key)); return Reflect.get(target, key); } }); } })],
  ["a function", () => () => {}], ["a class", () => class {}], ["a date", () => new Date(0)], ["a regular expression", () => /x/], ["a promise", () => Promise.resolve()], ["a weak map", () => new WeakMap()], ["an error", () => new Error("x")], ["a symbol", () => Symbol.iterator], ["a number", () => 5], ["a big integer", () => 5n], ["true", () => true],
];
for (let turn = 0; turn < 2; turn++) for (const [name, make] of cases) { attempt(name + ":", () => two(make())); const seen = told(); if (seen) say("  ", seen); }
attempt("undefined:", () => two(undefined)); attempt("null:", () => two(null));
