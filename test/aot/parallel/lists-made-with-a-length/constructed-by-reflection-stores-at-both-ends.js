// Made by test/aot/tools/generate-lists-made-with-a-length.py.
function make(n) { return Reflect.construct(Array, [n | 0]); }
function used(n) {
  const list = make(n);
  return (list[0] = "a", list[list.length ? list.length - 1 : 0] = "z", list[0] + list[list.length - 1] + list.length);
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
