// Instanceof an arrow function runs the getter that it inherits under prototype.
let hits = 0;
const target = () => {};
Object.setPrototypeOf(target, {
  __proto__: Function.prototype,
  get prototype() {
    hits++;
    return Object.prototype;
  },
});
console.log({} instanceof target, hits);
const held = { bound: target.bind(null) };
console.log({} instanceof held.bound, hits);
