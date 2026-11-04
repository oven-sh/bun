class Above {}
class Below extends Above {}
console.log(Below.prototype !== Above.prototype, Object.hasOwn(Below, "prototype"), Object.getPrototypeOf(Below.prototype) === Above.prototype);
const found = Object.getOwnPropertyDescriptor(Below, "prototype");
console.log(found.writable, found.enumerable, found.configurable);
