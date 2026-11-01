// Alone: what a loop knows of a list goes by every list that the executable holds
// A loop goes by the length of a list that grows through a second name in one of its turns: the list or another takes a store far behind its end.
const others = [];
try { JSON.parse("{"); } catch (e) { others.push(e); }
function f(given, pick, at) {
  const list = [...given];
  const w = pick ? list : others;
  let s = 0;
  for (let i = 0; i < list.length && i < 30; i++) {
    s += list[i] | 0;
    if (i === at) { w[12] = 7; }
  }
  return s + ":" + list.length;
}
console.log(f([1, 2, 3, 4, 5, 6], true, 1));
console.log(f([1, 2, 3, 4, 5, 6], false, 1));
console.log(f([1, 2, 3, 4, 5, 6], true, 1));
