// A spread under a declared type whose ordinary source has more names than the type: the names outside the type go to a new second object.
interface Point { a: number; b: number; c: string; d: number }
function digest(object: any): string {
  return Reflect.ownKeys(object).map(key => String(key) + "=" + String(object[key])).join() + (Object.isExtensible(object) ? "" : " closed");
}
function copy(source: any): Point {
  const point: Point = source;
  return { ...point };
}
const parsed = () => JSON.parse(`{"a":1,"b":2,"c":"three","d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"j":10,"k":11,"l":12}`);
const makers: Record<string, () => any> = {
  parsed,
  few: () => JSON.parse(`{"a":1,"b":2,"c":"three","d":4,"e":5}`),
  frozen: () => Object.freeze(parsed()),
  "wrong kinds": () => JSON.parse(`{"a":"one","b":null,"c":3,"d":{},"e":5,"f":6,"g":7,"h":8}`),
  deleted: () => { const made = parsed(); delete made.g; return made; },
  deletedThenBack: () => { const made = parsed(); delete made.g; made.g = "back"; return made; },
  getter: () => Object.defineProperty(parsed(), "h", { get() { return "got"; }, enumerable: true, configurable: true }),
  hidden: () => Object.defineProperty(parsed(), "h", { value: "hidden", enumerable: false, configurable: true }),
  symbol: () => { const made = parsed(); made[Symbol.for("s")] = 1; return made; },
  elements: () => { const made = parsed(); made[0] = "zero"; return made; },
  created: () => { const made = Object.create({ inherited: 1 }); Object.assign(made, parsed()); return made; },
};
for (const [firstName, first] of Object.entries(makers)) {
  for (const [secondName, second] of Object.entries(makers)) {
    let line = "";
    for (let turn = 0; turn < 12; turn++) {
      const made: any = copy(turn < 6 ? first() : second());
      made.a = turn;
      made.e = "changed";
      made.more = 1;
      line = digest(made);
    }
    console.log(firstName, secondName, line);
  }
}
const kept = parsed();
const copies = [];
for (let turn = 0; turn < 3000; turn++) copies.push(copy(kept));
kept.e = "later";
console.log(copies.every(made => (made as any).e === 5), digest(copies[2999]), digest(kept));
