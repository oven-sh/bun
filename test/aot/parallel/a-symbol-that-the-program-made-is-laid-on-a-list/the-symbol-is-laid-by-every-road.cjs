"use strict";
const mark = Symbol("mark");
const roads = {
  store: (a) => { a[mark] = 1; }, define: (a) => Object.defineProperty(a, mark, { value: 1, writable: true, enumerable: true, configurable: true }),
  defineHidden: (a) => Object.defineProperty(a, mark, { value: 1 }), defineMany: (a) => Object.defineProperties(a, { [mark]: { value: 1, enumerable: true } }),
  reflectSet: (a) => Reflect.set(a, mark, 1), reflectDefine: (a) => Reflect.defineProperty(a, mark, { value: 1 }), assign: (a) => Object.assign(a, { [mark]: 1 }),
  registered: (a) => { a[Symbol.for("mark")] = 1; }, spreadable: (a) => { a[Symbol.isConcatSpreadable] = false; }, iterator: (a) => { a[Symbol.iterator] = function* () { yield "mine"; }; },
  species: (a) => { a.constructor = { [Symbol.species]: function (n) { return { length: n, made: "species" }; } }; }, primitive: (a) => { a[Symbol.toPrimitive] = () => "prim"; }, tag: (a) => { a[Symbol.toStringTag] = "Tagged"; },
  twoSymbols: (a) => { a[mark] = 1; a[Symbol("second")] = 2; }, symbolThenText: (a) => { a[mark] = 1; a.map = () => "own map"; }, symbolThenWellKnown: (a) => { a[mark] = 1; a[Symbol.iterator] = function* () { yield "late"; }; },
};
function look(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return [s, [...a].join(), [0].concat(a).length, String(a.map((x) => x).made ?? a.map((x) => x + 1)), `${a}`, Object.prototype.toString.call(a), JSON.stringify(a), Object.getOwnPropertySymbols(a).length, Object.keys(a).join(), Array.from(a).join(), Math.max(...a), String(a[mark])].join(" ; "); }
for (const [name, road] of Object.entries(roads)) for (const make of [() => [1, 2, 3], () => JSON.parse("[1,2,3]"), () => [1, 2, 3].slice()]) { const a = make(); console.log(name, "before", look(a)); road(a); console.log(name, "behind", look(a)); }
