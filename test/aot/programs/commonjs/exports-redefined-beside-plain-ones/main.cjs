// Object.defineProperty() with a constant name gives one property of the exports object another form: an accessor, a constant, a hidden one. The properties beside it stay what they were, are stored and
// read as before, and keep their places among the keys.
const m = require("./made.cjs");
function show() {
  return [m.a, m.b, m.c, m.d, m.e, m.f[0], Object.keys(m).join(), JSON.stringify(Object.getOwnPropertyDescriptor(m, "a")), typeof Object.getOwnPropertyDescriptor(m, "b").get].join(" | ");
}
console.log(show());
for (let i = 0; i < 3; i++) m.bump();
console.log(show());
m.d = 5;
console.log(m.d, m.__esModule, "__esModule" in m, Object.keys(m).includes("__esModule"));
