const unseen = (0, eval)("(x) => x");
const spelled = { toString() { return "x"; } };

function count(list: number[], rounds: number): number {
  let hits = 0;
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < 2; k++) {
      if (k < list.length) {
        const a = list[k];
        const b: any = k === 0 ? 1 : spelled;
        if (a + b === "undefinedx") hits++;
      }
    }
  }
  return hits;
}

const holed: number[] = [1, 2, 3];
delete holed[1];
console.log(count(unseen(holed), 300));
