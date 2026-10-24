// The lazy pattern: a getter on the prototype computes a value and defines it on `this` under its own name, so that the next read finds an own field.
// The matching setter defines the field too. Both arrive after 3000 rounds; they fill the very slot whose emptiness sent the access to them.
// In this twin the class declares only what its constructor stores: the other fields are added late, through a cast to an interface.
let computed = 0;
let offered = 0;
interface LazyShape {
  id: number;
  value?: number;
}
const Lazy = class {
  declare id: number;
  constructor(id: number) {
    this.id = id;
  }
};
function valueOf(lazy: LazyShape) {
  return lazy.value;
}
function twice(lazy: LazyShape) {
  return `${lazy.value} ${lazy.value}`;
}
function store(lazy: LazyShape, value: number) {
  lazy.value = value;
  return lazy.value;
}
function state(lazy: LazyShape) {
  return `[${Object.keys(lazy)}] ${JSON.stringify(Object.getOwnPropertyDescriptor(lazy, "value"))}`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const lazy = new Lazy(i) as LazyShape;
  sum += valueOf(lazy) ?? 1;
  if (i & 1) sum += store(lazy, 2)!;
}
console.log("warm", sum);

const old = new Lazy(1) as LazyShape;
const oldFilled = new Lazy(2) as LazyShape;
store(oldFilled, 20);
Object.defineProperty(Object.getPrototypeOf(old), "value", {
  get(this: LazyShape) {
    computed++;
    Object.defineProperty(this, "value", { value: this.id * 11, writable: true, enumerable: true, configurable: true });
    return this.id * 11;
  },
  set(this: LazyShape, value: number) {
    offered++;
    Object.defineProperty(this, "value", { value: value + 0.5, writable: true, enumerable: false, configurable: true });
  },
  configurable: true,
});
console.log("before the first read:", state(old));
console.log("two reads in one function:", twice(old), computed, state(old));
console.log("an instance that had the field:", twice(oldFilled), computed);
const fresh = new Lazy(3) as LazyShape;
console.log("a store first:", store(fresh, 7), offered, state(fresh));
console.log("a second store:", store(fresh, 8), offered, state(fresh));
sum = 0;
for (let i = 0; i < 3000; i++) {
  const lazy = new Lazy(i & 7) as LazyShape;
  if (i & 1) sum += store(lazy, 2)!;
  sum += valueOf(lazy)! + valueOf(lazy)!;
}
console.log("many:", sum, computed, offered);
delete old.value;
console.log("emptied and read again:", twice(old), computed);
