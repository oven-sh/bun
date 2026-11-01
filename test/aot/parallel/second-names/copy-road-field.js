// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is read, written through a second name, and read again: the second name is a field read once.
const errors = [];
try { JSON.parse("{"); } catch (e) { errors.push(e); }
const box = { c: errors };
function f(list, pick) {
  const copy = [...list];
  if (pick) box.c = copy;
  const w = box.c;
  let s = 0;
  for (let i = 0; i < copy.length; i++) {
    s += copy[i];
    w[(i + 1) & 3] = 1.5;
  }
  return s;
}
console.log(f([1, 2, 3, 4], true));
console.log(f([1, 2, 3, 4], false));
