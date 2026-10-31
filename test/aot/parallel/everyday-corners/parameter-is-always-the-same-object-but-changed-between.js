// Parameter is always the same object but changed between: compiled answers as plain.
function read(o) {
  return o.a + o.b;
}
const o = { a: 1, b: 2 };
console.log(read(o));
o.b = "two";
console.log(read(o));
delete o.a;
console.log(read(o));
