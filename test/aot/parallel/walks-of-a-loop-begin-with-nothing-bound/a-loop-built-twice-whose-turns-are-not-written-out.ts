const unseen = (0, eval)("(x) => x");

function count(list: number[], others: any[], rounds: number): number {
  let hits = 0;
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < others.length; k++) {
      if (k < list.length) {
        const a = list[k];
        const b: any = others[k];
        if (a + b === "undefinedx") hits++;
      }
    }
  }
  return hits;
}

const holed: number[] = [1, 2, 3];
delete holed[1];
console.log(count(unseen(holed), unseen([1, "x", 2]), 300));
