const number = { __proto__: 1 }, text = { __proto__: "text" }, none = { __proto__: null }, missing = { __proto__: undefined };
console.log(Object.getPrototypeOf(number) === Object.prototype, Object.getPrototypeOf(text) === Object.prototype, Object.getPrototypeOf(none), Object.getPrototypeOf(missing) === Object.prototype);
console.log(Object.hasOwn(number, "__proto__"), Object.hasOwn(none, "__proto__"));
