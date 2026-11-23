// The prototype object of a constructor function that nothing constructs gets another parent before anything has asked whether its link is still the one that the build planned.
// Whoever asks afterwards has to find the new chain. The instance also goes to a function that nobody knows, so the build tests in two steps.
function told(ask) {
  try {
    return String(ask());
  } catch (error) {
    return "threw " + error.name;
  }
}
function Emitter() {}
function Middle() {}
Object.setPrototypeOf(Middle.prototype, Emitter.prototype);
class Lowest extends Middle {}
const first = new Lowest();
class Base {
  greet() {
    return "greet";
  }
}
told(() => {
  Object.setPrototypeOf(Emitter.prototype, Object.create(Base.prototype));
});
console.log(told(() => first instanceof Base), told(() => first.greet()), told(() => new Lowest() instanceof Base), told(() => first instanceof Emitter), told(() => nobodyKnows(first)));
