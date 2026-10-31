// Destructuring into members: compiled answers as plain.
const o = {},
  l = [];
({ a: o.x, b: l[1], c: o["y" + 1] = "dflt" } = { a: 1, b: 2 });
[o.z, ...l[2]] = "abc"[Symbol.iterator] ? ["p", "q", "r"] : [];
console.log(JSON.stringify(o), JSON.stringify(l));
