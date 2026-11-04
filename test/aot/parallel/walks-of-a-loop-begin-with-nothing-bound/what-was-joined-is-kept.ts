const unseen = (0, eval)("(x) => x");

function gather(list: number[], rounds: number): string {
  const kept: string[] = [];
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < 2; k++) {
      if (k < list.length) {
        const a = list[k];
        const b: any = k === 0 ? 1 : "x";
        if (r === rounds - 1) kept.push(String(a + b));
      }
    }
  }
  return kept.join();
}

const holed: number[] = [1, 2, 3];
delete holed[1];
console.log(gather(unseen(holed), 300));
