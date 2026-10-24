// A derived constructor has read its argument, calls super(), which damages that argument, and reads it again. Behind super() it also reads fields of `this` that the base constructor has stored and then damaged.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
class Base {
  base: number;
  constructor(p: Point) {
    this.base = p.y;
    if (strikes) {
      delete (p as any).x;
      (this as any).base = "text";
    }
  }
}
class Derived extends Base {
  told: string;
  constructor(p: Point) {
    const before = p.x;
    super(p);
    this.told = before + ">" + p.x + " " + this.base;
  }
}

function holder(p: Point): string {
  const before = p.x;
  const d = new Derived(p);
  return before + " " + d.told + " " + d.base + " " + p.x;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}
