// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is read, written through a second name, and read again: what is stored is a text.
const errors = [];
try { JSON.parse("{"); } catch (e) { errors.push(e); }
function f(list, pick) {
  const copy = [...list];
  const w = pick ? copy : errors;
  let s = "";
  for (let i = 0; i < copy.length; i++) {
    s += copy[i] + " ";
    w[(i + 1) & 3] = "t";
  }
  return s;
}
console.log(f([1.5, 2.5, 3.5, 4.5], true));
console.log(f([1.5, 2.5, 3.5, 4.5], false));
