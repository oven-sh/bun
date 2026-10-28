// Copies an object with a spread on each turn of a loop and increments one field of the copy. Built with every function hot and with --aot-check=MovedLoads.
type Pair = { n: number; m: number; extra?: number };

function countUp(turns: number): string[] {
  const seen: string[] = [];
  const first: Pair = { m: 7, n: -1 };
  for (let turn = 0; turn < turns; turn++) {
    const copy: Pair = { ...first, n: turn };
    copy.m++;
    seen.push(JSON.stringify(copy));
  }
  seen.push(String(first.n * 10 + first.m));
  return seen;
}

console.log(countUp(3).join(" "));
