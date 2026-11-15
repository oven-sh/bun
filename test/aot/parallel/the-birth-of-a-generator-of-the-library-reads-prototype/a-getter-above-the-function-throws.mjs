// The methods of process.allowedNodeEnvironmentFlags are generator functions of the library: they have no `prototype` of their own, so a program can lay one on them, or change what stands above them. What the read throws is thrown by the call.
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
Object.setPrototypeOf(made, { get prototype() { throw new RangeError("no"); } });
console.log(ask(), ask());
