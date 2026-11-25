const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
function dress(props) { return { kind: "plain", size: 1, open: false, ...props }; }
const door = [
  { id: 1, size: 2, text: "x" },
  { open: true, kind: "k" },
  { zeta: 1, id: 2 },
  Object.create({ inherited: 1 }, { size: { value: 9, enumerable: true }, hidden: { value: 1, enumerable: false }, text: { value: "c", enumerable: true } }),
  { get size() { return 7; }, text: "g" },
  new Proxy({ id: 5, text: "p" }, {}),
  null,
  undefined,
  "ab",
  [4, 5],
  { [Symbol.for("s")]: 1, id: 3 },
  JSON.parse(`{"text":"j","id":4,"size":5,"more":6}`),
  { text: "t", size: 3 },
  { text: undefined, size: undefined, id: undefined },
];
for (let t = 0; t < turns; t++) {
  out.push(show(dress({ text: "t" + t, size: t, id: t })));
  out.push(show(Reflect.apply(dress, undefined, [door[t % door.length]])));
}
console.log(out.join("\n"));
