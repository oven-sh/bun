// A `--define` whose value is a dotted path reads a member of a `var`, a parameter or a function of a function. Where the path begins at a `let` or `const` of a function, `bun run` may have put the value in place of the variable, and the build stops.
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
/* Build errors:
error: TS100050: --aot does not support --define P1=h1.length where "h1" is a let or const that is not at the top level of the file. The value is read as a name. A string needs quotes: --define 'P1="h1.length"'
error: TS100050: --aot does not support --define P2=h2.length where "h2" is a let or const that is not at the top level of the file. The value is read as a name. A string needs quotes: --define 'P2="h2.length"'
error: TS100050: --aot does not support --define P4=h4.length where "h4" is a let or const that is not at the top level of the file. The value is read as a name. A string needs quotes: --define 'P4="h4.length"'
error: TS100050: --aot does not support --define P5=h5.length where "h5" is a let or const that is not at the top level of the file. The value is read as a name. A string needs quotes: --define 'P5="h5.length"'
error: TS100050: --aot does not support --define P8=h8.length where "h8" is a let or const that is not at the top level of the file. The value is read as a name. A string needs quotes: --define 'P8="h8.length"'
*/
