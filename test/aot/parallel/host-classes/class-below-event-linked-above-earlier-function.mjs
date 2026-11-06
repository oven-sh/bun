// Emitter.prototype is linked below Base.prototype, and a class below Emitter is defined before Base is.
// Base stands below a host class, so only its own evaluation can define it.
function Emitter() {}
globalThis.handedOut = Emitter;
class Interface extends Emitter {}
globalThis.alsoHandedOut = new Interface();
class Base extends Event {
  greet() {
    return "greet";
  }
}
Object.setPrototypeOf(Emitter.prototype, Base.prototype);
console.log(globalThis.alsoHandedOut.greet(), new Interface() instanceof Base, typeof Base);
