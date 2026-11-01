// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is read, written through a second name, and read again: no loop.
const errors = [];
try { JSON.parse("{"); } catch (e) { errors.push(e); }
function f(list, pick) {
  const copy = [...list];
  const w = pick ? copy : errors;
  const a = copy[0];
  w[1] = 1.5;
  const b = copy[1];
  w[2] = 1.5;
  return a + " " + b + " " + copy[2];
}
console.log(f([1, 2, 3, 4], true));
console.log(f([1, 2, 3, 4], false));
