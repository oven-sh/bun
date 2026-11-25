// What only strict code refuses stays a SyntaxError where strict code evaluates it, and the strings beside it are made.
const attempt = (name, f) => {
  try {
    const made = f();
    console.log(name, typeof made, typeof made === "function" ? made(1, 2) : made);
  } catch (e) {
    console.log(name, e.name, e.message);
  }
};
attempt(0, () => eval('(function (a, a) {})'));
attempt(1, () => eval('(function* (a, a) {})'));
attempt(2, () => eval('(async function (a, a) {})'));
attempt(3, () => eval('(function (a, b, a) { return a; })'));
attempt(4, () => eval('(function (a) { return function (b, b) {}; })'));
attempt(5, () => eval('(function (a) { function inner(b, b) {} })'));
attempt(6, () => eval('(() => function (a, a) {})'));
attempt(7, () => eval('((a, a) => 1)'));
attempt(8, () => eval('({ m(a, a) {} })'));
attempt(9, () => eval('(function (a, b = 1, a) {})'));
attempt(10, () => eval('(function ({ a }, a) {})'));
attempt(11, () => eval('(function (a, ...a) {})'));
attempt(12, () => eval('(function () { { function f() {} function f() {} } })'));
attempt(13, () => eval('(function (x) { if (x) function f() {} })'));
attempt(14, () => eval('(function () { l: function f() {} })'));
attempt(15, () => eval('(function () { arguments = 1; })'));
attempt(16, () => eval('(function () { [arguments] = [1]; })'));
attempt(17, () => eval('(function () { arguments++; })'));
attempt(18, () => eval('(function (eval) {})'));
attempt(19, () => eval('(function () { var yield; })'));
attempt(20, () => eval('(function () { implements = 1; })'));
attempt(21, () => eval('(function (x) { delete x; })'));
attempt(22, () => eval('(function () { return 010; })'));
attempt(23, () => eval('(function () { try {} catch (eval) {} })'));
attempt(24, () => eval('(function (a, b) { return a + b; })'));
attempt(25, () => eval('((a, b) => a * b)'));
attempt(50, () => (0, eval)('(function (a, a) {})'));
attempt(60, () => new Function("x", 'return (function (a, a) {});')(1));
attempt(51, () => (0, eval)('(function* (a, a) {})'));
attempt(61, () => new Function("x", 'return (function* (a, a) {});')(1));
attempt(52, () => (0, eval)('(async function (a, a) {})'));
attempt(62, () => new Function("x", 'return (async function (a, a) {});')(1));
attempt(53, () => (0, eval)('(function (a, b, a) { return a; })'));
attempt(63, () => new Function("x", 'return (function (a, b, a) { return a; });')(1));
attempt(54, () => (0, eval)('(function (a) { return function (b, b) {}; })'));
attempt(64, () => new Function("x", 'return (function (a) { return function (b, b) {}; });')(1));
attempt(55, () => (0, eval)('(function (a) { function inner(b, b) {} })'));
attempt(65, () => new Function("x", 'return (function (a) { function inner(b, b) {} });')(1));
export {};
