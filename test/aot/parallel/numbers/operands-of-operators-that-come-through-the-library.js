// What an operator gives is typed by what arrives at its operands. Here it arrives through call, apply, bind, Reflect.apply, callbacks of the library, defaults, rest parameters, spread, `arguments`,
// objects of the engine's classes that are converted, a proxy and parsed text. Each result goes into a parameter of its own, and the code there leans on its type.
const report = value =>
  console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value));
function toldSum(n) {
  report(typeof n);
  report("" + n);
  report("" + n * n);
  report("" + -n);
  report(n === n);
  report(n > 5);
  let m = n;
  m++;
  report("" + m);
}
function toldDifference(n) {
  report(typeof n);
  report("" + n);
  report("" + n * n);
  report("" + -n);
  report(n === n);
  report(n > 5);
  let m = n;
  m++;
  report("" + m);
}
function toldProduct(n) {
  report(typeof n);
  report("" + n);
  report("" + n * n);
  report("" + -n);
  report(n === n);
  report(n > 5);
  let m = n;
  m++;
  report("" + m);
}
function toldDefault(n) {
  report(typeof n);
  report("" + n);
  report("" + n * n);
  report("" + -n);
  report(n === n);
  report(n > 5);
  let m = n;
  m++;
  report("" + m);
}
function toldGathered(n) {
  report(typeof n);
  report("" + n);
  report("" + n * n);
  report("" + -n);
  report(n === n);
  report(n > 5);
  let m = n;
  m++;
  report("" + m);
}
function toldCounted(n) {
  report(typeof n);
  report("" + n);
  report("" + n * n);
  report("" + -n);
  report(n === n);
  report(n > 5);
  let m = n;
  m++;
  report("" + m);
}
function toldBits(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function toldTwice(n) {
  report(n);
  report(n | 0);
  report(n + 0.5);
  report(n * 2);
  report(n > 2147483647);
  report(n < -2147483648);
  report(n === n);
  report(1 / n);
  report(n % 1);
  report(typeof n);
}
function add(a, b) {
  const sum = a + b;
  toldSum(sum);
  return sum;
}
function less(a, b) {
  toldDifference(a - b);
}
function times(a, b) {
  toldProduct(a * b);
}
function bits(a) {
  toldBits(a | 0);
}
function keep(n) {
  return n;
}
function twice(n) {
  toldTwice(keep(n) + keep(n));
}
function withDefault(a = 1.5, b = 2) {
  toldDefault(a * b);
}
function gathered(...list) {
  let sum = 0;
  for (const each of list) sum = sum + each;
  toldGathered(sum);
}
function counted() {
  let sum = 0;
  for (let i = 0; i < arguments.length; i++) sum += arguments[i];
  toldCounted(sum);
}
add(1, 2);
less(5, 3);
times(2, 3);
twice(4);
add.call(null, "a", 1);
less.apply(null, ["9", 1.5]);
times.bind(null, 2147483647)(2);
Reflect.apply(add, null, [1n, 2n]);
[1, 2, 3].forEach(bits);
[1.5, "2", null, undefined, 4294967297].forEach(bits);
[1, 2, 3].reduce(add);
[1, "2", 3].reduce(add);
[2147483647, 1].reduce(add);
["a", "b"].map(add);
withDefault();
withDefault(2);
withDefault(undefined, 3);
withDefault("4", "5");
gathered(1, 2, 3);
gathered(1, 2.5);
gathered(...[1, "x"]);
gathered(...[2147483647, 2147483647]);
counted(1, 2, 3);
counted(1, "2");
add([1, 2], 3);
add([], []);
less([7], 2);
less([1, 2], 2);
less(new Date(5), 1);
times(new Date(5), 2);
add(new Number(5), 1);
add(new String("5"), 1);
less(new String("5"), 1);
add(new Boolean(true), 1);
add(Object(5n), 1n);
add(/x/, 1);
add(null, [null]);
add({}, 1);
add(
  Object.create(null, {
    valueOf: {
      value() {
        return 2.5;
      },
    },
  }),
  1,
);
add(
  new Proxy(
    {},
    {
      get(target, key) {
        return key === "valueOf" ? () => "proxied" : undefined;
      },
    },
  ),
  1,
);
add(JSON.parse("1.5"), 1);
add(JSON.parse('"1.5"'), 1);
add(JSON.parse('{"n":3000000000}').n, 1);
bits(JSON.parse('{"n":3000000000}').n);
twice("abc".length);
twice("abc".charCodeAt(1));
twice("abc".charCodeAt(9));
twice("abc".indexOf("z"));
twice([1, 2, 3].length);
twice(new Array(4294967295).length);
twice([1, 2, 3].push(4));
twice(Math.imul(65536, 65536));
twice(Math.imul(46341, 46341));
twice(Math.clz32(1));
twice(Math.floor(2147483647.5));
twice(Math.floor(-0.5));
twice(Math.round(-0.2));
twice(Math.trunc(3000000000.7));
twice(Math.max(1, 2147483648));
twice(Math.min());
twice(Math.abs(-2147483648));
twice(Math.sign(-0));
twice(parseInt("2147483648"));
twice(parseInt("x"));
twice(Number("12"));
twice(Number.MAX_SAFE_INTEGER);
twice(Number.MIN_VALUE);
twice(new Int32Array([2147483647])[0]);
twice(new Uint32Array([4294967295])[0]);
twice(new Float64Array([0.5])[0]);
twice(new Uint8Array(2)[5]);
twice(new Map([[1, 2]]).size);
twice(new Set([1, 2]).size);
twice(Date.UTC(2020, 0));
report("end");
