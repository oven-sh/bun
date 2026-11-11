// a member of a class whose methods are called by name is deleted: a getter of that name above
class Base {
  get count(): number | undefined {
    return 41;
  }
  set count(value: number | undefined) {
    seen += "set" + value + ";";
  }
}
let seen = "";
class Counter extends Base {
  label: string = "c";
  constructor() {
    super();
    Object.defineProperty(this, "count", { value: 0, writable: true, enumerable: true, configurable: true });
  }
  step(by: number): number {
    this.count = (this.count ?? 0) + by;
    return this.count ?? -1;
  }
}
const counter = new Counter();
let total = 0;
for (let i = 0; i < 100; i++) total = (total + counter.step(i & 7)) | 0;
delete (counter as { count?: number }).count;
console.log(total, counter.count, counter.step(1), seen, Object.keys(counter).join());
