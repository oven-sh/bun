const unseen = (0, eval)("(x) => x");

function count(list, rounds) {
  let hits = 0;
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < 2; k++) {
      if (k < list.length) {
        const a = list[k];
        const b = k === 0 ? 1 : "x";
        if (a + b === "undefinedx") hits++;
      }
    }
  }
  return hits;
}

const holed = [1, 2, 3];
delete holed[1];
console.log(count(unseen(holed), 300));
