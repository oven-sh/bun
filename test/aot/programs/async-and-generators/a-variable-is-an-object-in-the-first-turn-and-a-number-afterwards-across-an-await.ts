class Box {
  constructor(public n: number, public next: Box | null) {}
}
async function f(a: number): Promise<number> {
  let nothing;
  let number: any = a;
  let held: any = new Box(a, null);
  let zero = 0;
  let turns = 2;
  let sum = 0;
  do {
    await nothing;
    for (const each of [zero]) {
      for (const none of []);
      if (typeof held === "number") {
        sum += held;
      } else
        try {
          sum += held.n * 1000;
        } finally {
          held = number;
        }
    }
  } while (--turns);
  return sum;
}
const all: Promise<number>[] = [];
for (let i = 0; i < 20; i++) all.push(f(i));
console.log((await Promise.all(all)).join());
