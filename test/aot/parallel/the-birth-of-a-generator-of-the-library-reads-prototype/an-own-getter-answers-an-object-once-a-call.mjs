// A control: nothing is thrown.
const holder = process.allowedNodeEnvironmentFlags;
const made = holder.values;
const realm = Object.getPrototypeOf(function* () {}).prototype;
function call() {
  return Reflect.apply(made, holder, []);
}
function above(born) {
  const found = Object.getPrototypeOf(born);
  return found === realm ? "the realm's" : found === null ? "null" : "mark" in found ? "mine: " + found.mark : "another";
}
function ask() {
  try {
    return above(call());
  } catch (error) {
    return "thrown: " + error.name + ": " + error.message;
  }
}
console.log(Object.hasOwn(made, "prototype"), ask());
let runs = 0;
Object.defineProperty(made, "prototype", { configurable: true, get() { runs++; return { mark: runs }; } });
console.log(ask(), ask(), runs);
