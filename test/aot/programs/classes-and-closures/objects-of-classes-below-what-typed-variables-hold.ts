// Classes extend what variables of a constructor type hold: the class that the type names, a number, undefined. Objects of them are made and read.
class Plain {
  sum: number;
  target: string;
  constructor(a: number, b: number) {
    this.sum = a + b;
    this.target = new.target.name;
  }
}
const early = Date.now() > 0;

const first: typeof Plain = (early ? Plain : 7) as any;
class OverFirst extends first {
  twice() {
    return this.sum * 2;
  }
}
const made = new OverFirst(1, 2);
console.log(made.sum, made.target, made.twice(), made instanceof Plain, Object.getPrototypeOf(OverFirst) === Plain);

const second: typeof Plain = (early ? 7 : Plain) as any;
try {
  class OverSecond extends second {}
  console.log(new OverSecond(1, 2).sum);
} catch (error) {
  console.log((error as Error).name);
}

const third: typeof Plain = (early ? undefined : Plain) as any;
try {
  class OverThird extends third {}
  console.log(new OverThird(1, 2).sum);
} catch (error) {
  console.log((error as Error).name);
}
