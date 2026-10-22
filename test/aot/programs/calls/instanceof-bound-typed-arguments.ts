// `x instanceof bound` asks the target of the bound function, whatever was bound with it: numbers and booleans, strings and objects, and the variables the target captures.
function Box(this: any, width: number, height: number, label: string, isOpen: boolean, owner: { name: string }): void {
  this.text = `${width * height} ${label} ${isOpen} ${owner.name}`;
}
function createCounter(step: number) {
  let created = 0;
  return function Counter(this: any, start: number, name: string): void {
    created += step;
    this.text = `${start + created} ${name}`;
  };
}
const owner = { name: "owner" };
const Counter = createCounter(2);
const box = new (Box as any)(2, 3, "plain", false, owner);
const counter = new (Counter as any)(1, "plain");

function report(name: string, bound: any, remaining: unknown[]): void {
  const created = new bound(...remaining);
  console.log(name, created.text, created instanceof bound, box instanceof bound, counter instanceof bound, {} instanceof bound, (1 as any) instanceof bound);
}

report("no argument", Box.bind(null), [1.5, 2, "a", true, owner]);
report("a number", Box.bind(null, 1.5), [2, "b", true, owner]);
report("two numbers", Box.bind(null, 1.5, 2), ["c", false, owner]);
report("a string", Box.bind(null, 1.5, 2, "d"), [true, owner]);
report("a boolean", Box.bind(null, 1.5, 2, "e", true), [owner]);
report("an object", Box.bind(null, 1.5, 2, "f", false, owner), []);
report("captured variables", Counter.bind(null), [10, "g"]);
report("captured variables and a number", Counter.bind(null, 10), ["h"]);
report("captured variables, a number and a string", Counter.bind(null, 10, "i"), []);

const boundBeforeStore = Box.bind(null, 1.5);
Box.prototype = { isReplaced: true };
console.log(box instanceof boundBeforeStore, new (Box as any)(1, 1, "j", true, owner) instanceof boundBeforeStore, new (boundBeforeStore as any)(1, "k", true, owner).isReplaced);
export {};
