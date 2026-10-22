// A table under null answers undefined for the names of Object.prototype, so a handler that is looked up by a name from outside is one that the program has stored.
let total = 0;
const handlers: any = { __proto__: null };
const created: any = Object.create(null);
const ordinary: any = {};
handlers.add = created.add = ordinary.add = (amount: number) => { total += amount; };

const names = ["add", "toString", "constructor", "__proto__", "hasOwnProperty", "valueOf", "__defineGetter__", "missing"];
for (const name of names) {
  for (const table of [handlers, created, ordinary]) {
    const handler = table[name];
    console.log(name, typeof handler, name in table);
    if (typeof handler === "function" && name === "add") handler(1);
  }
}
console.log(total);
handlers["__proto__"] = { add: (amount: number) => { total += 100 * amount; } };
console.log(Object.keys(handlers).join(), Object.getPrototypeOf(handlers), typeof handlers.__proto__.add);
handlers.__proto__.add(1);
ordinary["__proto__"] = { extra: (amount: number) => { total += 10000 * amount; } };
ordinary.extra(1);
console.log(total, Object.keys(ordinary).join());
