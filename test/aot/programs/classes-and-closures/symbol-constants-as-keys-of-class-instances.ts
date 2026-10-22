// A symbol that a module keeps in a constant is a property name where the receiver is `this` of a class without a layout.
// IR= 0 Task (ElemGet|ElemSet)
// IR= 0 start (ElemGet|ElemSet)
// IR= 0 finish (ElemGet|ElemSet)
// IR= 0 describe (ElemGet|ElemSet)
const state = Symbol("state");
const owner = Symbol("owner");
const steps = Symbol("steps");
const unnamed = Symbol();

class Task extends Promise<number> {
  static get [Symbol.species]() {
    return Promise;
  }
  declare [state]: number;
  declare [owner]: string | null;
  declare [steps]: number[];
  declare [unnamed]: boolean;
  constructor(name: string | null) {
    super(() => {});
    this[state] = 0;
    this[owner] = name;
    this[steps] = [];
    this[unnamed] = true;
  }
  start(): this {
    this[state] |= 1;
    this[steps].push(this[state]);
    return this;
  }
  finish(): number {
    this[state] |= 2;
    this[steps].push(this[state]);
    return this[steps].length;
  }
  describe(): string {
    return `${this[owner]} ${this[state]} ${this[steps].join()} ${this[unnamed]}`;
  }
}

class Rows extends Array<number> {
  declare [owner]: string;
  mark(name: string): this {
    this[owner] = name;
    return this;
  }
  marked(): string | undefined {
    return this[owner];
  }
}

const task = new Task("first").start();
console.log(task.finish(), task.describe());
console.log(Object.getOwnPropertySymbols(task).map(String).join(), Object.getOwnPropertySymbols(task)[0] === state, Object.keys(task).length);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(task, owner)), state in task, Symbol("state") in task, Reflect.has(task, unnamed));
const other = new Task(null);
console.log(other.describe(), delete (other as unknown as Record<symbol, unknown>)[owner], other.describe(), Object.getOwnPropertySymbols(other).length);
Object.defineProperty(other, state, { get: () => 40, set() {}, configurable: true });
console.log(other.start().describe(), other.finish());
Object.freeze(task);
try {
  task.start();
} catch (error) {
  console.log((error as Error).constructor.name);
}
const rows = new Rows(1, 2, 3);
console.log(rows.marked(), rows.mark("mine").marked(), rows.length, rows.map(x => x * 2) instanceof Rows, Object.getOwnPropertySymbols(rows).map(String).join());
const proxied = new Proxy(new Rows(), {
  get(target, key, receiver) {
    return key === owner ? "from the proxy" : Reflect.get(target, key, receiver);
  },
});
console.log(Rows.prototype.marked.call(proxied), Rows.prototype.marked.call(Object.assign(Object.create(Rows.prototype), { [owner]: "assigned" })));
let total = 0;
for (let i = 0; i < 3000; i++) total += new Task("t").start().finish();
console.log(total);
