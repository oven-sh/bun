// Made by test/aot/tools/generate-lists-made-with-a-length.py.
function make(n) { return new Array((n | 0) - 2); }
function used(n) {
  const list = make(n);
  return Array.isArray(list) + " " + (list.constructor === Array) + " " + (Object.getPrototypeOf(list) === Array.prototype) + " " + Object.prototype.toString.call(list);
}
function safely(n) {
  try {
    return String(used(n));
  } catch (error) {
    return "thrown: " + error.name + (/^(Array length|Object prototype|Property description)/.test(error.message) ? ": " + error.message : "");
  }
}
const lengths = [-1, -2147483648, 0, 1, 3, 8, 9, 1000, 5000, 99999, 100000, 100001, 2147483647, 4294967295, 4294967296, 2.5, -0, NaN, Infinity];
for (let turn = 0; turn < 2; turn++) for (let i = 0; i < lengths.length; i++) console.log(lengths[i], safely(lengths[i]));
