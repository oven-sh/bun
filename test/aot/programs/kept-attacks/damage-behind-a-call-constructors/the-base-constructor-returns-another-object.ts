// In some rounds the constructor of the base class returns an object of its own making, so `this` in the derived constructor is not what the class would have made. The derived constructor stores its fields into it, and the caller reads them.
let swaps = false;
const stranger: any = { x: "stranger" };
class Base {
  x: number;
  constructor(x: number) {
    this.x = x;
    if (swaps) return stranger;
  }
}
class Derived extends Base {
  y: number;
  constructor(x: number, y: number) {
    super(x);
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}

function holder(n: number): string {
  const d = new Derived(n, 1);
  const read = d.x + "," + d.y;
  let sum: string;
  try {
    sum = "" + d.sum();
  } catch (error) {
    sum = (error as Error).name;
  }
  return read + " " + sum + " " + (d instanceof Derived) + " " + (d === stranger);
}

for (let round = 0; round < 300; round++) {
  swaps = round % 100 === 99;
  const line = holder(round);
  if (swaps || round === 0) console.log(round + ": " + line);
}
