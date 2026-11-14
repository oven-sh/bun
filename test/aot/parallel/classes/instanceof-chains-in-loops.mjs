// Chains of instanceof in loops: classes of the engine, classes of the program, primitives, null, proxies, objects without a prototype, prototypes that change between two turns, own Symbol.hasInstance.
const lines = [];
class Mine extends Error { code = 1; }
class Deep extends Mine { code = 2; }
class Plain {}
class Below extends Plain {}
function Old() {}
Old.prototype.kind = "old";
class Even { static [Symbol.hasInstance](value) { return value === 2; } }
const trap = new Proxy(new TypeError("t"), {});
const asked = new Proxy({}, { getPrototypeOf() { lines.push("asked"); return RangeError.prototype; } });
const makers = [() => new Error("a"), () => new TypeError("b"), () => new RangeError("c"), () => new SyntaxError("d"), () => new Mine("m"), () => new Deep("d"), () => ({}), () => [], () => new Map(), () => new Date(0), () => 5, () => "text", () => null, () => undefined, () => Symbol("s"), () => 1n, () => true, () => Object.create(null), () => new Plain(), () => new Below(), () => new Old(), () => trap, () => asked, () => () => 1, () => Object.create(TypeError.prototype), () => Object.setPrototypeOf({}, Deep.prototype), () => new AggregateError([]), () => 2, () => new Uint8Array(1), () => /x/];
const values = makers.map(make => make());
function chain(list, turns) { let t = ""; for (let i = 0; i < turns; i++) { const e = list[i % list.length]; if (e instanceof TypeError) t += "T"; else if (e instanceof RangeError) t += "R"; else if (e instanceof Error) t += "E"; else t += "-"; } return t; }
function own(list, turns) { let t = ""; for (let i = 0; i < turns; i++) { const e = list[i % list.length]; if (e instanceof Deep) t += "D" + e.code; else if (e instanceof Mine) t += "M" + e.code; else if (e instanceof Error) t += "E"; else if (e instanceof Below) t += "B"; else if (e instanceof Plain) t += "P"; else if (e instanceof Old) t += "O"; else t += "-"; } return t; }
function mixed(list, turns) { let n = 0; for (let i = 0; i < turns; i++) { const e = list[i % list.length]; n += (e instanceof Array ? 1 : 0) + (e instanceof Object ? 2 : 0) + (e instanceof Function ? 4 : 0) + (e instanceof Map ? 8 : 0) + (e instanceof Date ? 16 : 0) + (e instanceof Even ? 32 : 0) + (e instanceof RegExp ? 64 : 0); } return n; }
function negated(list, turns) { let n = 0; for (let i = 0; i < turns; i++) { const e = list[i % list.length]; if (!(e instanceof Error)) continue; if (!(e instanceof Mine) && !(e instanceof TypeError)) n += 1; else if (e instanceof Mine && e instanceof Deep) n += 10; else n += 100; } return n; }
function kept(list, turns) { const seen = []; for (let i = 0; i < turns; i++) { const e = list[i % list.length]; const isError = e instanceof Error; const isMine = e instanceof Mine; seen.push(isError === isMine, isError && !isMine); } return seen.filter(Boolean).length; }
function dynamic(list, classes, turns) { let t = ""; for (let i = 0; i < turns; i++) { for (const c of classes) t += list[i % list.length] instanceof c ? 1 : 0; t += " "; } return t; }
const errors = values.slice(0, 6);
for (let turn = 0; turn < 3; turn++) {
  lines.push(chain(errors, 25), chain(values, 60), own(errors, 25), own(values, 60), String(mixed(values, 60)), String(negated(values, 60)), String(kept(values, 60)), dynamic(values, [Error, Mine, Plain, Array, Even], 31));
  lines.push(chain([values[1]], 9), own([values[5]], 9), chain([], 0), chain([null, 5, values[0]], 9));
  if (turn === 0) { Object.setPrototypeOf(values[0], Deep.prototype); Object.setPrototypeOf(Below.prototype, Mine.prototype); }
  if (turn === 1) { Object.setPrototypeOf(values[1], null); Old.prototype = { kind: "new" }; Object.setPrototypeOf(values[6], Plain.prototype); }
}
for (const [name, bad] of Object.entries({ number: 5, object: {}, arrow: Object.assign(() => 1, { prototype: 5 }), nothing: undefined })) { try { let n = 0; for (let i = 0; i < 4; i++) n += values[i] instanceof bad ? 1 : 0; lines.push(name + n); } catch (error) { lines.push(name + error.constructor.name); } }
for (const line of lines) console.log(line);
