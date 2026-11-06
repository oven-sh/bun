import * as assert from "assert";
import { bench, run } from "../runner.mjs";

bench("deepEqual", () => {
  assert.deepEqual({ foo: "123", bar: "baz" }, { foo: "123", bar: "baz" });
});

bench("deepStrictEqual", () => {
  assert.deepStrictEqual({ foo: "123", beep: "boop" }, { foo: "123", beep: "boop" });
});

// Objects that were built in different ways have different structures, and take the key-by-key walk.
const literal = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
const parsed = JSON.parse(JSON.stringify(literal));
const reversed = { h: 8, g: 7, f: 6, e: 5, d: 4, c: 3, b: 2, a: 1 };

bench("deepStrictEqual (parsed and literal)", () => {
  assert.deepStrictEqual(parsed, literal);
});

bench("deepStrictEqual (different key order)", () => {
  assert.deepStrictEqual(reversed, literal);
});

// Two objects of one structure that holds a symbol key: string keys are compared first.
const tag = Symbol("tag");
const tagged = () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, [tag]: 8 });
const taggedA = tagged();
const taggedB = tagged();

bench("deepStrictEqual (objects with a symbol key)", () => {
  assert.deepStrictEqual(taggedA, taggedB);
});

const arrayA = [1, 2, 3];
const arrayB = [1, 2, 3];

bench("deepStrictEqual (arrays)", () => {
  assert.deepStrictEqual(arrayA, arrayB);
});

// From its first hole on an array is compared by its keys.
const holes = () => [1, , 3, , 5];
const holesA = holes();
const holesB = holes();
const holesWithKeyA = Object.assign(holes(), { x: 1 });
const holesWithKeyB = Object.assign(holes(), { x: 1 });
const long = () => {
  const array = Array.from({ length: 1_000_000 }, (_, index) => index);
  delete array[500_000];
  return array;
};
const longA = long();
const longB = long();

bench("deepStrictEqual (arrays with holes)", () => {
  assert.deepStrictEqual(holesA, holesB);
});

bench("deepStrictEqual (arrays with holes and a named key)", () => {
  assert.deepStrictEqual(holesWithKeyA, holesWithKeyB);
});

bench("deepStrictEqual (1e6 elements and one hole)", () => {
  assert.deepStrictEqual(longA, longB);
});

// Arrays that JavaScriptCore stores another way: after a shift(), and frozen.
const queue = () => {
  const array = Array.from({ length: 1001 }, (_, index) => index);
  array.shift();
  delete array[500];
  return array;
};
const queueA = queue();
const queueB = queue();
const frozen = () => {
  const array = Array.from({ length: 100 }, (_, index) => index);
  delete array[50];
  return Object.freeze(array);
};
const frozenA = frozen();
const frozenB = frozen();

bench("deepStrictEqual (1000 elements after a shift(), one hole)", () => {
  assert.deepStrictEqual(queueA, queueB);
});

bench("deepStrictEqual (100 frozen elements, one hole)", () => {
  assert.deepStrictEqual(frozenA, frozenB);
});

// Every read of an array behind a Proxy is a trap.
const thousand = Array.from({ length: 1000 }, (_, index) => index);
const behindProxy = new Proxy(thousand.slice(), {});
const behindGetTrap = new Proxy(thousand.slice(), {
  get: (target, key, receiver) => Reflect.get(target, key, receiver),
});

bench("deepStrictEqual (1000 elements behind a Proxy)", () => {
  assert.deepStrictEqual(behindProxy, thousand);
});

bench("deepStrictEqual (1000 elements behind a get trap)", () => {
  assert.deepStrictEqual(thousand, behindGetTrap);
});

// The named keys of an array or a typed array are compared by another walk.
const match = () => "2026-11-02".match(/(?<year>\d+)-(?<month>\d+)/);
const matchA = match();
const matchB = match();
const taggedArrayA = Object.assign([1, 2, 3], literal);
const taggedArrayB = Object.assign([1, 2, 3], literal);
const taggedBytesA = Object.assign(new Uint8Array(3), literal);
const taggedBytesB = Object.assign(new Uint8Array(3), literal);

bench("deepStrictEqual (RegExp match arrays)", () => {
  assert.deepStrictEqual(matchA, matchB);
});

bench("deepStrictEqual (arrays with named keys)", () => {
  assert.deepStrictEqual(taggedArrayA, taggedArrayB);
});

bench("deepStrictEqual (typed arrays with named keys)", () => {
  assert.deepStrictEqual(taggedBytesA, taggedBytesB);
});

// Objects whose own keys a listing of their own adds to: RegExps and arguments objects.
const rule = () => ({ test: /\.tsx?$/, exclude: /node_modules/, use: "loader" });
const ruleA = rule();
const ruleB = rule();
const passed = function () {
  return arguments;
};
const passedA = passed(1, 2, 3);
const passedB = passed(1, 2, 3);

bench("deepStrictEqual (RegExps)", () => {
  assert.deepStrictEqual(/ab+c/gi, /ab+c/gi);
});

bench("deepStrictEqual (objects that hold RegExps)", () => {
  assert.deepStrictEqual(ruleA, ruleB);
});

bench("deepStrictEqual (arguments objects)", () => {
  assert.deepStrictEqual(passedA, passedB);
});

// A Proxy with a get trap, as a reactive object has.
const reactive = () =>
  new Proxy({ ...literal }, { get: (target, key, receiver) => Reflect.get(target, key, receiver) });
const reactiveA = reactive();
const reactiveB = reactive();

bench("deepStrictEqual (literal and a Proxy with a get trap)", () => {
  assert.deepStrictEqual(literal, reactiveA);
});

bench("deepStrictEqual (two Proxies with a get trap)", () => {
  assert.deepStrictEqual(reactiveA, reactiveB);
});

await run();
