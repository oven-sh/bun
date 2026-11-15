const table = new Map([["k", { ["__proto__"]: 1, a: 2 }]]);
const held = table.get("k");
console.log(Object.keys(held).join(), held.a, Object.getPrototypeOf(held) === Object.prototype, Object.hasOwn(held, "__proto__"));
const bag = new Set([{ ["__proto__"]: 3, b: 4 }]);
for (const each of bag) console.log(Object.keys(each).join(), each.b);
