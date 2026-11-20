// The storage and the length of a list are carried from one push, pop or length to the next one in a loop. The rare ways read them again.
// STATISTIC: ListStoragesCarried >= 15
"use strict";
class Stack {
  #list = [];
  constructor(...list) { this.#list.push(...list); }
  push(value) { this.#list.push(value); }
  pop() { return this.#list.pop(); }
  get size() { return this.#list.length; }
  get text() { return this.#list.length + ":" + this.#list.slice(-6).map(String).join(); }
}
function work(stack, turns, first, second) {
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    stack.push(first(k));
    stack.push(second(k));
    sum += stack.size;
    sum += stack.pop() + stack.pop() + stack.size;
    stack.push(k);
    if (k % 5 === 4) { stack.pop(); stack.pop(); stack.pop(); stack.pop(); sum += stack.size; }
  }
  return sum + " " + stack.text;
}
function integers(turns) {
  const list = [];
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    list.push(k & 7);
    list.push(1);
    sum += list.pop() + list.pop() + list.length;
    list.push(k);
    list.push(k + 1);
    sum += list.length;
    if (k % 3 === 2) { sum += list.pop(); sum += list.pop(); sum += list.length; }
  }
  return sum + " " + list.length + " " + list.slice(-4);
}
function given(list, turns, value) {
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    list.push(value);
    list.push(k);
    sum += list.length;
    sum += typeof list.pop() === "number" ? 1 : 2;
    list.pop();
    list.pop();
    sum += list.length * 3;
  }
  return sum + " " + list.length + " " + Object.keys(list).join();
}
const makes = [(k) => k, (k) => k / 2, (k) => "s" + k, (k) => (k === 7 ? 0.5 : k), (k) => (k === 11 ? "late" : k), (k) => (k % 4 === 3 ? undefined : k), (k) => -0, (k) => (k > 20 ? { valueOf: () => k } : k)];
for (let round = 0; round < makes.length; round++) for (const turns of [0, 1, 2, 5, 40, 150]) {
  console.log(round, turns, work(new Stack(), turns, makes[round], makes[0]), work(new Stack(1, 2, 3), turns, makes[0], makes[round]), work(new Stack("a", 0.5), turns, makes[round], makes[round]), integers(turns));
}
const lists = [() => [], () => [1], () => [0.5, 1.5], () => ["a", "b"], () => [1, , 3], () => [, ,], () => new Array(4), () => Object.freeze([1, 2]), () => Object.seal([1, 2]), () => Object.preventExtensions([1]), () => Object.defineProperty([1, 2], "length", { writable: false }), () => { const a = [1]; a[5000] = 2; return a; }, () => new (class extends Array {})(), () => Object.defineProperty([1, 2, 3], "1", { get: () => 9, configurable: true })];
for (const make of lists) for (const value of [1, 0.5, "v", undefined]) for (const turns of [1, 4, 30]) {
  try { console.log(turns, given(make(), turns, value)); } catch (error) { console.log(error.constructor.name); }
}
