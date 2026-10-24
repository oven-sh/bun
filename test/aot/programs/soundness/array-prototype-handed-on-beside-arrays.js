// Array.prototype is an array itself. A function that takes it beside arrays whose contents are known treats each as what it is.
function describe(value) {
  return Array.isArray(value) + " " + (value === Array.prototype) + " " + (Array.isArray(value) ? value.length + " " + value.join() : typeof value);
}
console.log(describe([1, 2, 3]));
console.log(describe(Array.prototype));
console.log(describe(5));
console.log(describe("x"));
const holders = [Array.prototype, ["at", "push"], Map.prototype, undefined];
for (const holder of holders) console.log(holder === undefined ? "none" : Array.isArray(holder) ? "array of " + holder.length : typeof holder);
