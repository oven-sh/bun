// The descriptors of `length` and `name` of a class and of a function have a `value`: the number of parameters and the name.
function str(v) {
  return "" + v;
}
class Made {}
function plain(a, b) {}
console.log(str(Object.getOwnPropertyDescriptor(Made, "length").value), str(Object.getOwnPropertyDescriptor(Made, "name").value));
console.log(str(Object.getOwnPropertyDescriptor(plain, "length").value), str(Object.getOwnPropertyDescriptor(plain, "name").value));
