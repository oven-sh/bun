// The prototype object of a plain function is an ordinary object below Object.prototype with one property, `constructor`, which is not enumerable. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const plain = hide(function plain() {});
const made = plain.prototype;
const described = Object.getOwnPropertyDescriptor(plain, "prototype");
const constructor = Object.getOwnPropertyDescriptor(made, "constructor");
console.log(typeof made, made.constructor === plain, Object.getPrototypeOf(made) === Object.prototype, Object.getOwnPropertyNames(made).join(), Object.keys(made).length);
console.log(described.writable, described.enumerable, described.configurable, constructor.writable, constructor.enumerable, constructor.configurable, Reflect.deleteProperty(plain, "prototype"), plain.prototype === made);
