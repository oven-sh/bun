// Alone: what a loop knows of a list goes by every list that the executable holds
// A loop goes by the length of a list that grows through a second name in one of its turns: a field appends.
const others = [];
try { JSON.parse("{"); } catch (e) { others.push(e); }
const box = { c: others };
function f(given, pick, at) {
  const list = [...given];
  if (pick) box.c = list;
  let s = "";
  for (let i = 0; i < list.length && i < 30; i++) {
    s += list[i] + ",";
    if (i === at) { box.c.push(7); }
  }
  return s + list.length;
}
console.log(f([1, 2, 3, 4, 5, 6], true, 1));
console.log((box.c = others, f([1, 2, 3, 4, 5, 6], false, 1)));
console.log(f([1, 2, 3, 4, 5, 6], true, 1));
