const unseen = (0, eval)("(x) => x");
type Pair = { one: number; two: number };

function count(list: number[], pair: Pair, rounds: number): number {
  let hits = 0;
  for (let r = 0; r < rounds; r++) {
    let k = 0;
    for (const name in pair) {
      if (k < list.length) {
        const a = list[k];
        const b: any = name === "one" ? 1 : "x";
        if (a + b === "undefinedx") hits++;
      }
      k++;
    }
  }
  return hits;
}

const holed: number[] = [1, 2, 3];
delete holed[1];
console.log(count(unseen(holed), unseen({ one: 1, two: 2 }), 300));
