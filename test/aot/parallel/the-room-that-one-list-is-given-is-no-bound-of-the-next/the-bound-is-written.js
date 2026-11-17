// Two lists are pushed onto in each turn: the first is born empty and is given no room, the second is born with an element.
const names = ["a", "b", "c", "d"];
function both() {
  const low = [];
  const high = [0];
  for (let i = 0; i < 300; i++) {
    low.push(names[i & 3]);
    high.push(i);
  }
  return [low, high];
}
const [low, high] = both();
console.log("SAID", low.length, high.length, low.at(-1), high.at(-1));
