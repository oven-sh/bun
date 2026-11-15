const unseen = (0, eval)("(x) => x");

function count(list: number[], rounds: number): string {
  let hits = 0;
  let sum = 0;
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < 3; k++) {
      if (k < list.length) {
        const a = list[k];
        const b: any = k === 2 ? "x" : k + 1;
        const joined = a + b;
        if (joined === "undefinedx") hits++;
        else sum += joined;
      }
    }
  }
  return hits + " " + sum;
}

const holed: number[] = [1, 2, 3, 4];
delete holed[2];
console.log(count(unseen(holed), 300));
