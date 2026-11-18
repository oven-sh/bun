function check(actual, expected) {
  if (!Object.is(actual, expected)) throw new Error(`${String(actual)} instead of ${String(expected)}`);
}

// What a function gives once it is hot is what it gave at first.
function checkStable(source, warm, inputs) {
  const attempt = (f, input) => {
    try {
      return f(...input);
    } catch (error) {
      return error.name;
    }
  };
  const expected = inputs.map(input => attempt(new Function("a", "b", source + "// cold"), input));
  const hot = new Function("a", "b", source);
  for (let i = 0; i < 200; i++) hot(...warm);
  for (let round = 0; round < 300; round++) {
    inputs.forEach((input, index) => check(attempt(hot, input), expected[index]));
  }
}

const numbers = [0, -0, 1, -1, 0.5, -0.5, 2.5, 2 ** 31 - 1, -(2 ** 31), 2 ** 32, 2 ** 53, NaN, Infinity];
const values = [...numbers, undefined, null, true, "3", "é世", 1n, [], {}];
const pairs = values.flatMap(a => [0, -0, 1.5, 2 ** 31 - 1, NaN, "x", true].map(b => [a, b]));
for (const warm of [
  [1, 2],
  [1.5, 2.5],
]) {
  for (const name of ["abs", "ceil", "floor", "round", "trunc", "sqrt", "fround", "clz32", "imul", "max", "min"]) {
    checkStable(`var r = Math.${name}(a${Math[name].length > 1 ? ", b" : ""}); return r`, warm, pairs);
  }
  for (const call of ["pow(a, b)", "max(a, b, 1)", "min(a)", "abs(a)", "ceil(a)"]) {
    checkStable(`"use strict"; return Math.${call}`, warm, pairs);
  }
  for (const operator of ["+", "-", "*", "/", "%", "&", "|", "<<", ">>>", "<", "==", "==="]) {
    checkStable(`return a ${operator} b`, warm, pairs);
  }
}
for (const name of ["charCodeAt", "charAt", "codePointAt", "at"]) {
  const inputs = ["", "abc", "é世😀", new String("s")].flatMap(a => values.map(b => [a, b]));
  checkStable(`var r = a.${name}(b); return r`, ["abc", 1], inputs);
}

// Blocks that first run when the function is hot.
function stages(stage) {
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += i & 1;
  if (stage > 0) for (let i = 0; i < 2000; i++) sum += i * 0.5;
  if (stage > 1) {
    try {
      null.x;
    } catch {
      for (const it of [1, 2, 3]) sum += it;
    }
  }
  return sum;
}
for (let i = 0; i < 90; i++) check(stages((i / 30) | 0), [1000, 1000500, 1000506][(i / 30) | 0]);

function* resumes(late) {
  for (let i = 0; i < 100; i++) yield i;
  if (late) yield (yield late.x) + 1;
}
for (let i = 0; i < 60; i++) check([...resumes(i < 30 ? null : { x: 1 })].length, i < 30 ? 100 : 102);

// Fewer arguments than parameters.
function describe(a, b, c, d, e) {
  return [arguments.length, a, b, c, d, e].join();
}
const callers = [f => f(), f => f(1), f => f(1, 2), f => f(1, 2, 3), f => f(1, 2, 3, 4)];
for (let i = 0; i < 300; i++) {
  callers.forEach((call, count) => {
    const given = [1, 2, 3, 4].slice(0, count);
    check(call(describe), [count, ...given, ...Array(5 - count)].join());
    if (i < 200) return;
    check(call(describe.bind(null, 0)), [count + 1, 0, ...given, ...Array(4 - count)].join());
    check(
      call((...rest) => rest.join()),
      given.join(),
    );
    check(call(Math.max), Math.max(...given));
  });
}

// Arguments that come from a list, or from `bind`.
const upTo = length => Array.from({ length }, (_, index) => index);
const list = (...all) => all.join();
class Base {
  constructor(...all) {
    this.all = all.join();
  }
}
class Derived extends Base {
  constructor(...all) {
    super(...all);
  }
}
const spreaders = [
  given => list(...given),
  given => list.apply(null, given),
  given => Reflect.apply(list, null, given),
  given => new Base(...given).all,
  given => new Derived(...given).all,
  given =>
    function () {
      return list.apply(this, arguments);
    }.apply(null, given),
];
for (let i = 0; i < 300; i++) {
  for (const given of [upTo(i % 9), upTo(i), [0.5, 1.5], [1, , 3], ["a", null, {}]]) {
    for (const spread of spreaders) check(spread(given), given.join());
  }
  const [bound, passed] = [upTo(i % 40), upTo((i * 7) % 300)];
  check(list.bind(null, ...bound)(...passed), [...bound, ...passed].join());
  check(new (Base.bind(null, ...bound))(...passed).all, [...bound, ...passed].join());
  check(list.bind(null, 1).bind(null, ...bound)(), [1, ...bound].join());
}

let chain = list;
for (let i = 0; i < 40; i++) chain = chain.bind(null, ...upTo(i & 3));
const callChain = () => chain().length;
for (let i = 0; i < 300; i++) check(callChain(), 119);

// Literals whose elements change their kind.
const literal = (a, b) => [a, , b];
for (const [a, b] of [
  [1, 2],
  [1.5, 2],
  [NaN, 1],
  ["a", null],
]) {
  for (let i = 0; i < 200; i++) {
    const array = literal(a, b);
    check(array.length, 3);
    check(1 in array, false);
    check(array.push(a), 4);
    check(array.pop(), a);
    check(array.pop(), b);
    check(array.pop(), undefined);
    check(array.pop(), a);
  }
}
"done";
