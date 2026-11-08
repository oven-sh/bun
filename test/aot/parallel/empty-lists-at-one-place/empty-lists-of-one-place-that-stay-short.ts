function makeShelf(): unknown[] {
  return [];
}
function makeRack(): unknown[] {
  return [];
}
const kept: unknown[][] = [];
let sum = 0;
for (let round = 0; round < 60000; round++) {
  const shelf = makeShelf();
  if (round % 10000 === 9999) {
    shelf.push(round);
    shelf.push(round + 0.5);
    shelf.push("text" + round);
    shelf.push({ round });
    kept.push(shelf);
  } else if (round % 7 === 0) {
    shelf.push(round);
    sum += (shelf[0] as number) + shelf.length;
  } else sum += shelf.length;
  const rack = makeRack();
  rack.push(round);
  rack.push(round + 1);
  if (round % 3 === 0) rack.push(round + 2);
  if (round % 20000 === 19999) {
    rack.push(-0);
    rack[7] = round;
    kept.push(rack);
  }
  sum += (rack[1] as number) + rack.length;
}
console.log(sum);
for (const list of kept) console.log(list.length, JSON.stringify(list), Object.keys(list).join());
