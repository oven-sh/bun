// Arguments escapes and is changed: compiled answers as plain.
function f(a) {
  const all = arguments;
  g(all);
  return a;
}
function g(x) {
  x[0] = "by g";
}
console.log(f(1), f());
