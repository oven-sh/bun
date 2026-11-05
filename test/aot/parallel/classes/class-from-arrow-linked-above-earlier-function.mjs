// A class below Error comes out of an arrow function that is called in place, and is linked above the prototype of a function.
// A class below that function made an object first, so the class was asked for its prototype before it was evaluated.
function Emitter() {}
class Interface extends Emitter {}
const first = new Interface();
const Base = (() => class extends Error {})();
Reflect.setPrototypeOf(Emitter.prototype, Base.prototype);
const questions = [
  () => Base === Base.prototype.constructor,
  () => Object.getPrototypeOf(Base) === Error,
  () => new Emitter() instanceof Base,
  () => new Base() instanceof Error,
  () => first instanceof Base,
];
for (const ask of questions) {
  try {
    console.log(ask());
  } catch (error) {
    console.log("threw", error.name);
  }
}
