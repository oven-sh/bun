const original = Error;
class Failure extends Error {
  get kind() {
    return "failure";
  }
}
globalThis.Error = class Other {};
console.log(Object.getPrototypeOf(Failure) === original, new Failure("x") instanceof original, new Failure("x") instanceof Error, new Failure("text").message);
