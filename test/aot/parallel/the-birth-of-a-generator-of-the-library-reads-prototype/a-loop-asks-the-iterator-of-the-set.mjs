// The methods of process.allowedNodeEnvironmentFlags are generator functions of the library: they have no `prototype` of their own, so a program can lay one on them, or change what stands above them. What the read throws is thrown by the call.
const holder = process.allowedNodeEnvironmentFlags;
Object.defineProperty(holder[Symbol.iterator], "prototype", { configurable: true, get() { throw new RangeError("no"); } });
function count() {
  let seen = 0;
  try {
    for (const flag of holder) seen++;
  } catch (error) {
    return error.name + " behind " + seen;
  }
  return "no error";
}
console.log(count(), count());
