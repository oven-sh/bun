// Alone: what a loop knows of a list goes by every list that the executable holds
// A loop goes by the length of a list that grows through a second name in one of its turns: a second parameter stores at the end.
const others = [];
try { JSON.parse("{"); } catch (e) { others.push(e); }
function f(list, w, at) {
  let s = "";
  for (let i = 0; i < list.length && i < 30; i++) {
    s += list[i] + ",";
    if (i === at) { w[w.length] = 7; }
  }
  return s + list.length;
}
console.log(((l) => f(l, l, 1))([1, 2, 3, 4, 5, 6]));
console.log(f([1, 2, 3, 4, 5, 6], others, 1));
console.log(((l) => f(l, l, 1))([1, 2, 3, 4, 5, 6]));
