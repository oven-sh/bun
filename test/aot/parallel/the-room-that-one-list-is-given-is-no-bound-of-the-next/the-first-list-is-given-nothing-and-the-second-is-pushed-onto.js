// Two lists are filled in one loop. The first is born empty and is given no room; the second is born with an element, and the turns push onto it.
function split(list) {
  const low = [];
  const high = [list[0]];
  for (let i = 1; i < list.length; i++) {
    low.push(list[i] - 1);
    high.push(list[i] + 1);
  }
  return [low, high];
}
const list = [];
const turns = Number(process.argv[2] ?? 300);
for (let i = 0; i < turns; i++) list.push(i * 2);
const [low, high] = split(list);
console.log("SAID", low.length, high.length, low.at(-1), high.at(-1), high[0]);
