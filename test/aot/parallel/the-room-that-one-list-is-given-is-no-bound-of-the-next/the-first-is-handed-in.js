// The first list is handed in; the second is born with an element, and the turns push onto both.
function split(list, low) {
  const n = list.length;
  const high = [list[0]];
  for (let i = 1; i < n; i++) {
    low.push(list[i] - 1);
    high.push(list[i] + 1);
  }
  return high;
}
const list = [];
const turns = Number(process.argv[2] ?? 300);
for (let i = 0; i < turns; i++) list.push(i * 2);
const low = [];
const high = split(list, low);
console.log("SAID", low.length, high.length, low.at(-1), high.at(-1), high[0]);
