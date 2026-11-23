// The methods of process.allowedNodeEnvironmentFlags are generator functions of the library: they have no `prototype` of their own, so a program can lay one on them, or change what stands above them. What the read throws is thrown by the call.
const holder = process.allowedNodeEnvironmentFlags;
Object.defineProperty(holder.keys, "prototype", { configurable: true, get() { throw new RangeError("no"); } });
function ask() {
  let step = 1;
  try {
    step = 2;
    holder.keys();
    step = 3;
  } catch (error) {
    return error.name + " at step " + step;
  }
  return "no error, step " + step;
}
console.log(ask(), ask());
