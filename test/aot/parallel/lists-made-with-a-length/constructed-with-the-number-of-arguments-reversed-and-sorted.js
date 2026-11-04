// Made by test/aot/tools/generate-lists-made-with-a-length.py.
function counted() { return new Array(arguments.length); }
function make(n) { return n === 0 ? counted() : n === 1 ? counted(1) : n === 2 ? counted(1, 2) : n === 3 ? counted(1, 2, 3) : counted(1, 2, 3, 4); }
function used(n) {
  const list = make(n);
  return (list[0] = 2, list.reverse(), list.sort(), JSON.stringify(list));
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
