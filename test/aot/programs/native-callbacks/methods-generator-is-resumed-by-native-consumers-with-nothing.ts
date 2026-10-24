// Methods found through instances: a generator whose `yield` is typed to receive a number is resumed with undefined by Array.from, Set, a spread, Promise.all and yield*, and closed early by Map; the program's own calls send numbers.
export {};

let total = 0;

function* steps(): Generator<number, void, number> {
  try {
    for (let i = 0; i < 3; i++) {
      const sent = yield i;
      total += typeof sent === "number" ? sent : sent === undefined ? 100 : 10000;
    }
  } finally {
    total += 100000;
  }
}

function* outer(): Generator<number, void, number> {
  yield* steps();
}

const own = steps();
own.next(0);
own.next(1);
own.next(2);
own.next(3);
const counts = [Array.from(steps()).length, new Set(steps()).size, Math.max(...(steps() as any)), (await Promise.all(steps())).length, [...(outer() as any)].length];
try {
  new Map(steps() as any);
} catch {
  counts.push(-1);
}
console.log(total, counts.join());
