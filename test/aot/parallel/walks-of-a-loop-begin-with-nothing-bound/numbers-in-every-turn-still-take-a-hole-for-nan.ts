const unseen = (0, eval)("(x) => x");

function count(list: number[], rounds: number): string {
  let holes = 0;
  let sum = 0;
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < 2; k++) {
      if (k < list.length) {
        const b = k === 0 ? 1 : 2;
        const joined = list[k] + b;
        if (joined !== joined) holes++;
        else sum += joined;
      }
    }
  }
  return holes + " " + sum;
}

const holed: number[] = [1, 2, 3];
delete holed[1];
console.log(count(unseen(holed), 300));
