// In a file without types too a method called on the array literal that it was read off is resolved by the class of the literal: the code in place is taken while the array has its original structure, also where an argument is a call, so that the method is read first.
// IR= 0 lists TypeTest v[0-9]+ testedType=builtin\(
// IR= 2 lists CallBuiltin v[0-9]+ \(v[0-9]+\) overload=ArrayPrototypePush/
// IR= 0 prepended TypeTest v[0-9]+ testedType=builtin\(
// IR= 1 prepended CallBuiltin v[0-9]+ \(v[0-9]+\) overload=ArrayPrototypeUnshift/
function name(text) {
  return text + "!";
}
function same(value) {
  return value;
}
function lists(properties) {
  const entries = Object.entries(properties);
  const names = [];
  const values = [];
  for (let i = 0, length = entries.length; i < length; i++) {
    names.push(name(entries[i][0]));
    values.push(same(entries[i][1]));
  }
  return { names, values };
}
function prepended(items, make) {
  const result = [];
  for (const item of items) result.unshift(make(item));
  return result;
}
const made = lists({ id: 1, name: "a", email: "b", nothing: undefined });
console.log(made.names.join(), made.values.join(), made.names.length, made.values.length);
console.log(prepended([1, 2, 3], x => x * 2).join());
function shadowed(items) {
  const result = [];
  result.push = function (item) {
    return Array.prototype.push.call(this, "<" + item + ">");
  };
  for (const item of items) result.push(same(item));
  return result;
}
console.log(shadowed(["a", "b"]).join(), Object.keys(shadowed(["c"])).join());
