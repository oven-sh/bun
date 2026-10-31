// One function gets a proxy and an object: compiled answers as plain.
function sum(o) {
  let s = 0;
  for (let i = 0; i < 3; i++) s += o.v;
  return s;
}
let n = 0;
console.log(
  sum({ v: 1 }),
  sum(new Proxy({}, { get: () => ++n })),
  sum({
    get v() {
      return ++n;
    },
  }),
  sum(Object.create({ v: 2 })),
  sum([]),
  sum("s"),
);
