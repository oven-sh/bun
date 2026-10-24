// Methods found through instances: Array.prototype.push, pop, unshift and fill, called on an instance of a class, store numbers through its setters and read through its getters; the program stores strings.
let total = 0;

class Shelf {
  held = "0";
  get length(): string {
    return this.held;
  }
  set length(value: string) {
    total += typeof value === "string" ? 1 : typeof value === "number" ? 100 : 10000;
    this.held = value;
  }
  set 0(value: string) {
    total += typeof value === "string" ? 100000 : typeof value === "number" ? 1000000 : 10000000;
  }
}

const shelf = new Shelf();
shelf.length = "0";
shelf[0] = "book";
const like: any = shelf;
const results: unknown[] = [Array.prototype.push.call(like, 7), typeof shelf.held, Array.prototype.push.call(like, 8, 9), Array.prototype.pop.call(like), (Array.prototype.fill.call(like, {}) as any).held, Array.prototype.unshift.call(like, 1)];
console.log(total, results.join(), shelf.length + 1);
