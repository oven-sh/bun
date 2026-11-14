// Accessors and properties above primitives and built-in objects, read in loops: description, size, flags, byteLength and others, on values of one kind, of several kinds, and where the read throws.
const lines = [];
const attempt = read => { try { return String(read()); } catch (error) { return error.constructor.name; } };
const symbol = Symbol("kind"), bare = Symbol(), boxed = Object(Symbol("boxed")), global = /a/gi, plain = /b/, map = new Map([[1, 2]]), set = new Set([1, 2, 3]), view = new Uint16Array(4), buffer = new ArrayBuffer(8), url = new URL("http://a.example:81/x?y#z"), text = "text", big = 12n, number = 5.5, date = new Date(0), error = new RangeError("e"), fn = function named(a, b) {}, promise = Promise.resolve(1);
function description(turns) { let r = 0; for (let i = 0; i < turns; i++) r += symbol.description.length; return r; }
function descriptions(list, turns) { let r = ""; for (let i = 0; i < turns; i++) r += list[i % list.length].description + (list[i % list.length].description?.length ?? "none"); return r; }
function sizes(turns) { let r = 0; for (let i = 0; i < turns; i++) { r += map.size + set.size; if (i === 2) set.add(9); if (i === 4) map.clear(); } return r; }
function flags(turns) { let r = ""; for (let i = 0; i < turns; i++) { r += global.flags + plain.flags.length + global.source.length + global.lastIndex; global.test("xa"); } return r; }
function views(turns) { let r = 0; for (let i = 0; i < turns; i++) r += view.byteLength + view.length + buffer.byteLength + view.byteOffset; return r; }
function urls(turns) { let r = 0; for (let i = 0; i < turns; i++) { r += url.href.length + url.port.length + url.hash.length; if (i === 1) url.hash = "longer"; } return r; }
function lengths(turns) { let r = 0; for (let i = 0; i < turns; i++) r += text.length + fn.length + fn.name.length + error.message.length + error.name.length; return r; }
function constructors(list, turns) { let r = ""; for (let i = 0; i < turns; i++) r += list[i % list.length].constructor.name.length; return r; }
function missing(list, turns) { let r = ""; for (let i = 0; i < turns; i++) r += attempt(() => list[i % list.length].missing.length); return r; }
function mixedNames(list, turns) { let r = ""; for (let i = 0; i < turns; i++) { const value = list[i % list.length]; r += attempt(() => value.name.length) + attempt(() => value.message.length) + attempt(() => value.size.length) + attempt(() => value.description.length); } return r; }
const all = [symbol, boxed, global, map, set, view, buffer, url, text, big, number, date, error, fn, promise, true];
for (let turn = 0; turn < 2; turn++) {
  lines.push(String(description(9)), descriptions([symbol, bare, boxed], 9), String(sizes(6)), flags(5), String(views(5)), String(urls(4)), String(lengths(5)), constructors(all, 33), missing(all, 20), mixedNames(all, 33));
  for (const read of [() => Symbol.prototype.description, () => Map.prototype.size, () => RegExp.prototype.flags, () => Object.getPrototypeOf(Uint8Array.prototype).byteLength, () => URL.prototype.href, () => Object.create(map).size, () => Object.create(symbol.constructor.prototype).description]) lines.push(attempt(() => { let r = ""; for (let i = 0; i < 3; i++) r += read(); return r; }));
}
class Below extends Map { get size() { return 77; } }
const below = new Below([[1, 1]]);
function belowSizes(list, turns) { let r = 0; for (let i = 0; i < turns; i++) r += list[i % list.length].size; return r; }
lines.push(String(belowSizes([map, below, { size: 5 }, set], 9)));
Object.defineProperty(boxed, "description", { value: [1, 2, 3] });
lines.push(descriptions([boxed, symbol], 4));
for (const line of lines) console.log(line);
