// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: what is stored: text.
let spare; try { JSON.parse("{"); } catch (e) { spare = [e]; }
function f(list, pick) { const copy = [...list]; const w = pick ? copy : spare; let s = 0; for (let i = 0; i < copy.length; i++) { s += copy[i]; w[(i + 1) & 3] = "t"; } return s; }
console.log(f([1, 2, 3, 4], true) + ""); console.log(f([4, 5, 6, 7], false) + "");
