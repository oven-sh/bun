// Held from creation: then, catch, finally and the static combinators construct the subclass with an executor that native code made; the program's own executors are closures with one parameter that return a number.
export {};

let total = 0;

class Counted extends Promise<number> {
  constructor(executor: (resolve: (value: number) => void) => number) {
    let returned: unknown = "not run";
    super((resolve, reject) => {
      returned = (executor as any)(resolve, reject);
    });
    total += executor.length === 1 ? 1 : executor.length === 2 ? 100 : 10000;
    total += typeof returned === "number" ? 100000 : returned === undefined ? 10000000 : 0;
  }
}

const first = new Counted(resolve => (resolve(1), 5));
const chained = first.then(value => value + 1);
const caught = chained.catch(() => 0);
const last = caught.finally(() => {});
const all = Counted.all([first, 2]);
const resolved = Counted.resolve(3);
const values = [await chained, await last, (await all).length, await resolved];
console.log(total, values.join(), chained instanceof Counted, all instanceof Counted);
