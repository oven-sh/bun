// A call that is refused for a primitive throws, and only the handler makes the operand an object.
function main() {
let target = 1;
let result = "none";
for (let i = 0; i < 3; i++) {
  try {
    result = Reflect.get(target, "a");
  } catch (error) {
    target = { a: { late: "yes" } };
  }
}
console.log(typeof result, result.late);

let holder = "text";
let keys = null;
for (let i = 0; i < 3; i++) {
  try { keys = Reflect.ownKeys(holder); } catch (error) { holder = { x: 1, y: 2 }; }
}
console.log(keys.length, keys[0]);

let proto = 5;
let made = null;
for (let i = 0; i < 3; i++) {
  try { made = Object.create(proto); } catch (error) { proto = { inherited() { return "from proto"; } }; }
}
console.log(made.inherited());

let definedOn = null;
let answer = 0;
for (let i = 0; i < 3; i++) {
  try {
    Object.defineProperty(definedOn, "p", { get() { return "getter ran"; } });
    answer = definedOn.p;
  } catch (error) { definedOn = { p: 1 }; }
}
console.log(answer);
}
main();
