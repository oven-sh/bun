let hits = 0;
const holder = { method() {} };
Object.defineProperty(holder.method, "prototype", {
  get() {
    hits++;
    return Array.prototype;
  },
});
function test(value, constructor) {
  return value instanceof constructor;
}
console.log(test([], holder.method), test({}, holder.method), hits);
