const w = JSON.parse('{"left":"alphabet-soup-with-noodles-and-croutons-","right":"served-in-a-bowl-of-the-finest-porcelain"}');
const written = new Map([["alphabet-soup-with-noodles-and-croutons-served-in-a-bowl-of-the-finest-porcelain", 1], ["salad", 2]]);
function mixed() {
  const made = new Map();
  for (let i = 0; i < 2; i++) made.set(i + 0.5, i);
  made.set(w.left + w.right, 1);
  return made;
}
function ask(map, left, right, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += map.get(left + right);
  return sum;
}
console.log(ask(written, w.left, w.right, 1000000), ask(mixed(), w.left, w.right, 1000000));
