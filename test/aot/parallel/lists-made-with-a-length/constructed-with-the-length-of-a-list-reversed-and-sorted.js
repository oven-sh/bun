// Made by test/aot/tools/generate-lists-made-with-a-length.py.
function make(n) { const model = []; for (let i = 0; i < n && i < 50; i++) model.push(i); return new Array(model.length); }
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
