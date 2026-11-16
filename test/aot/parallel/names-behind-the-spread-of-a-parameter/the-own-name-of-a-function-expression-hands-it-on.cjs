// STATISTIC: ObjectSpreadsExpandedToDefines = 0
const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
let keep;
const step = function own(state, i) { keep = own; return { ...state, busy: i > 1, more: i }; };
const dress = function self(props) { keep2 = self; return { kind: "plain", size: 1, ...props }; };
var keep2;
const door = [
  { id: 1, open: false, text: "x", count: 9 },
  { zeta: 1, id: 2 },
  { more: 5, busy: 6, id: 2 },
  Object.create({ inherited: 1 }, { count: { value: 9, enumerable: true }, hidden: { value: 1, enumerable: false }, text: { value: "c", enumerable: true } }),
  { get count() { return 7; }, text: "g" },
  new Proxy({ id: 5, text: "p" }, {}),
  null,
  undefined,
  "ab",
  [4, 5],
  { [Symbol.for("s")]: 1, id: 3 },
  JSON.parse(`{"text":"j","id":4,"count":5,"more":6}`),
];
for (let t = 0; t < turns; t++) {
  out.push(show(step({ id: t, text: "t" + t, count: 2, open: true }, t)));
  out.push(show(keep(door[t % door.length], t)));
  out.push(show(dress({ id: t, text: "t" + t, count: 2, open: true })));
  out.push(show(keep2(door[t % door.length])));
}
console.log(out.join("\n"));
