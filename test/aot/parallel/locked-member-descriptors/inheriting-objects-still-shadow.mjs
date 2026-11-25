// An object that inherits a locked member can shadow it by assignment, also after the descriptor of the member was read and defined again.
function check(label) {
  class List extends Array {}
  const push = function () {
    return "mine";
  };
  List.prototype.push = push;
  const heir = Object.create(Buffer);
  heir.concat = push;
  const plain = {};
  plain.toString = push;
  plain.hasOwnProperty = push;
  const lengthHolder = Object.create(Array.prototype);
  lengthHolder.length = 3;
  console.log(label, new List().push(), heir.concat(), plain.toString(), plain.hasOwnProperty(), Object.hasOwn(lengthHolder, "length"), JSON.stringify(Object.getOwnPropertyDescriptor(heir, "concat")));
}
check("before");
for (const [object, key] of [[Array.prototype, "push"], [Buffer, "concat"], [Object.prototype, "toString"], [Object.prototype, "hasOwnProperty"], [Array.prototype, "length"]])
  console.log(key, Reflect.defineProperty(object, key, Reflect.getOwnPropertyDescriptor(object, key)));
Object.defineProperties(Math, Object.getOwnPropertyDescriptors(Math));
check("after");
Math.tau = 2 * Math.PI;
Array.prototype.last = function () {
  return this[this.length - 1];
};
console.log(Math.tau > 6, [1, 2].last(), JSON.stringify(Object.getOwnPropertyDescriptor(Math, "tau")));
