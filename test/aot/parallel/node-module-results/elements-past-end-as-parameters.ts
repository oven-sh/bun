import { basename } from "node:path";

const words = basename("import read slice word other").split(" ");
const numbers = words.map(word => word.length);

function count(a: string, b: string): number {
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) if (a[i] === b[j]) same++;
  }
  return same;
}

function scale(a: number, rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += a * i;
  return sum;
}

function attempt(call: () => unknown): void {
  try {
    console.log(call());
  } catch (error) {
    console.log((error as Error).name);
  }
}

for (let k = 0; k <= words.length; k++) {
  attempt(() => count(words[k], words[k + 1]));
  attempt(() => count(words[0], words[k]));
  attempt(() => scale(numbers[k], 4));
}
attempt(() => count(null as any, words[0]));
attempt(() => scale(undefined as any, 2));
attempt(() => scale("3" as any, 3));
