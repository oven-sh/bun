// As ./variable-of-module-added-to-in-loop-every-way-out.ts, with variables of an enclosing function that an inner function adds to in a loop and another inner function reads.
function counter(start: number) {
  let count = start;
  let text = "";
  return {
    adds(turns: number): void {
      for (let i = 0; i < turns; i++) count += i & 3;
    },
    startsAgain(turns: number): number {
      let sum = 0;
      for (let i = 0; i < turns; i++) {
        count += 7;
        if (count > 64) {
          sum += count;
          count = 0;
        }
      }
      return sum;
    },
    writes(turns: number): void {
      for (let i = 0; i < turns; i++) {
        text += "a";
        if (text.length === 5) text = "";
      }
    },
    now(): string {
      return count + ":" + text;
    },
  };
}

const first = counter(0);
const second = counter(50);
for (const turns of [0, 1, 3, 20, 0]) {
  first.adds(turns);
  second.adds(turns + 1);
  console.log(first.now(), second.now());
  console.log(first.startsAgain(turns), second.startsAgain(turns * 2), first.now(), second.now());
  first.writes(turns);
  second.writes(turns + 2);
  console.log(first.now(), second.now());
}
