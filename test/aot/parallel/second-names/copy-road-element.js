// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is read, written through a second name, and read again: the second name is an element of a list.
const errors = [];
try { JSON.parse("{"); } catch (e) { errors.push(e); }
const lists = [errors];
function f(list, pick) {
  const copy = [...list];
  if (pick) lists[0] = copy;
  const w = lists[0];
  let s = 0;
  for (let i = 0; i < copy.length; i++) {
    s += copy[i];
    w[(i + 1) & 3] = 1.5;
  }
  return s;
}
console.log(f([1, 2, 3, 4], true));
console.log(f([1, 2, 3, 4], false));
