// A `--define` whose value is a dotted path reads a member of the variable of the function that has its first name: a `const`, a `let`, a `var`, a parameter or a function. `bun run` puts the string of a `const` in place of its name and leaves the `const` out, so there the path finds no variable. Plain Bun prints another output.
// Flags: --define P1=h1.length --define P2=h2.length --define P3=h3.length --define P4=h4.length --define P5=h5.length --define P6=h6.length --define P7=h7.length --define P8=h8.length --define O9=h9
const t = g => {
  try {
    return g();
  } catch (e) {
    return e.constructor.name;
  }
};
function a() {
  const h1 = "abcde";
  return P1;
}
function b() {
  let h2 = "abcde";
  return P2;
}
function c() {
  var h3 = "abcde";
  return P3;
}
function d() {
  const h4 = { length: 7 };
  return P4;
}
function e() {
  const h5 = String("abcdefgh");
  return P5;
}
function f(h6) {
  return P6;
}
function g() {
  function h7() {}
  return P7;
}
function h() {
  const h8 = "abcde";
  return [P8, h8.length].join();
}
function i() {
  const h9 = "abcde";
  return O9;
}
console.log(
  t(a),
  t(b),
  t(c),
  t(d),
  t(e),
  t(() => f("ab")),
  t(g),
  t(h),
  t(i),
);
/* Output:
5 5 5 7 8 2 0 5,5 abcde
*/
