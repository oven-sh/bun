// Made by test/aot/tools/generate-lists-made-with-a-length.py.
function make(n) { return new Array((n | 0) * 2); }
function used(n) {
  const list = make(n);
  return Object.keys(list).length + " " + Object.getOwnPropertyNames(list).join();
}
function safely(n) {
  try {
    return String(used(n));
  } catch (error) {
    return "thrown: " + error.name + (/^(Array length|Object prototype|Property description)/.test(error.message) ? ": " + error.message : "");
  }
}
const lengths = [0, 1, 2, 3, 4, 7, 8, 9, 33, 100];
for (let turn = 0; turn < 2; turn++) for (let i = 0; i < lengths.length; i++) console.log(lengths[i], safely(lengths[i]));
