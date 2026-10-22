// Every array method that looks at the elements alone, called on lists that were given a property of their own: an ordinary name, a name that other methods look for, a name that looks like a number, a method of the same name, an accessor, an index accessor, another prototype, a frozen list.
const makers = {
  plain: () => [1, 2, 3, 4],
  named: () => { const a = [1, 2, 3, 4]; a.pos = 7; return a; },
  constructorOfItsOwn: () => { const a = [1, 2, 3, 4]; a.constructor = function () { return { made: true }; }; return a; },
  species: () => { const a = [1, 2, 3, 4]; a.constructor = { [Symbol.species]: function (n) { return { length: 0, species: n }; } }; return a; },
  notSpreadable: () => { const a = [1, 2, 3, 4]; a[Symbol.isConcatSpreadable] = false; return a; },
  minusOne: () => { const a = [1, 2, 3, 4]; a["-1"] = 9; return a; },
  fraction: () => { const a = [1, 2, 3, 4]; a[1.5] = 9; return a; },
  farIndex: () => { const a = [1, 2, 3, 4]; a[6] = 9; return a; },
  joinOfItsOwn: () => { const a = [1, 2, 3, 4]; a.join = () => "mine"; return a; },
  pushOfItsOwn: () => { const a = [1, 2, 3, 4]; a.push = function (v) { this[this.length] = v * 2; return -1; }; return a; },
  findOfItsOwn: () => { const a = [1, 2, 3, 4]; a.find = () => "mine"; return a; },
  namedAccessor: () => { const a = [1, 2, 3, 4]; Object.defineProperty(a, "pos", { get() { log.push("get pos"); return 7; }, enumerable: true }); return a; },
  indexAccessor: () => { const a = [1, 2, 3, 4]; Object.defineProperty(a, 1, { get() { log.push("get 1"); return 20; }, set(v) { log.push("set 1 " + v); }, configurable: true, enumerable: true }); return a; },
  otherPrototype: () => { const a = [1, 2, , 4]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 2: "above" }); return a; },
  frozen: () => { const a = [1, 2, 3, 4]; a.pos = 7; return Object.freeze(a); },
  sealed: () => { const a = [1, 2, 3, 4]; a.pos = 7; return Object.seal(a); },
  holed: () => { const a = [1, , 3, 4]; a.pos = 7; return a; },
};
const methods = {
  push: a => a.push(5),
  pop: a => a.pop(),
  shift: a => a.shift(),
  unshift: a => a.unshift(0),
  at: a => a.at(-1),
  find: a => a.find(v => v > 1),
  findLast: a => a.findLast(v => v < 4),
  findIndex: a => a.findIndex(v => v === 3),
  findLastIndex: a => a.findLastIndex(v => v === 3),
  forEach: a => { let s = ""; a.forEach((v, i, self) => { s += v + ":" + i + (self === a ? "" : "!"); }); return s; },
  some: a => a.some(v => v === 3),
  every: a => a.every(v => v > 0),
  reduce: a => a.reduce((s, v) => s + v),
  reduceRight: a => a.reduceRight((s, v) => s + "" + v, ""),
  indexOf: a => a.indexOf(3),
  lastIndexOf: a => a.lastIndexOf(3),
  includes: a => a.includes(undefined),
  join: a => a.join("-"),
  fill: a => a.fill(8, 1, 2),
  reverse: a => a.reverse(),
  copyWithin: a => a.copyWithin(0, 2),
  toReversed: a => a.toReversed(),
  toSpliced: a => a.toSpliced(1, 1, "x"),
  with: a => a.with(0, "x"),
  slice: a => a.slice(1),
  concat: a => a.concat([5]),
  map: a => a.map(v => v * 2),
  filter: a => a.filter(v => v > 1),
  flat: a => a.flat(),
  toString: a => a.toString(),
};
let log = [];
function show(value) {
  if (Array.isArray(value)) { let text = "["; for (let i = 0; i < value.length; i++) text += (i ? "," : "") + (i in value ? String(value[i]) : "-"); return text + "]" + Object.keys(value).filter(key => !/^\d+$/.test(key)).join("|"); }
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
for (const [madeAs, make] of Object.entries(makers)) {
  for (const [name, call] of Object.entries(methods)) {
    let line = "";
    for (let round = 0; round < 40; round++) {
      log = [];
      const list = make();
      let answer;
      try { answer = show(call(list)); } catch (error) { answer = error.constructor.name; }
      line = madeAs + " " + name + " " + answer + " " + show(list) + " " + log.join(";");
    }
    console.log(line);
  }
}
