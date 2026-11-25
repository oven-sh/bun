const order: string[] = [];
const withGetter = {
  get seen() {
    order.push("getter");
    return 1;
  },
};
const custom = {
  [Symbol.for("nodejs.util.inspect.custom")]() {
    order.push("custom");
    return "printed by its own method";
  },
};
const proxy = new Proxy(
  { a: 1 },
  {
    ownKeys(target) {
      order.push("ownKeys");
      return Reflect.ownKeys(target);
    },
  },
);
const throws = {
  [Symbol.for("nodejs.util.inspect.custom")]() {
    throw new RangeError("out of the printer");
  },
};
const all: any[] = [withGetter, custom, proxy];
for (const value of all) console.log(value);
for (const value of all) console.error(value);
for (const print of [console.log, console.info, console.debug, console.warn, console.error]) {
  try {
    print(throws);
  } catch (error) {
    order.push((error as Error).constructor.name);
  }
}
try {
  console.log(throws);
} catch (error) {
  order.push("caught " + (error as Error).message);
}
console.log(order.join());
const kept = console.log;
console.log = (value: unknown) => kept("laid over: " + String(value));
console.log(JSON.parse('"a text"'));
console.log = kept;
console.log(JSON.parse('"a text"'));
