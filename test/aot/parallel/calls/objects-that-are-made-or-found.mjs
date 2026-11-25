// A helper in a loop returns an object that it has just made on some ways and one that it found on others: the caller takes it apart on each way by itself.
const found = new Map([[1, { size: 10, name: "one", tags: ["a"] }], [4, { name: "four", size: 40 }], [5, null]]);
const standing = { size: 7, name: "standing", tags: [] };
function partOf(n) { if (n < 0) return standing; const held = found.get(n); if (held) return held; return { size: n * 2, name: "made" + (n & 1), tags: null }; }
function spanOf(list, i) { return i < list.length ? list[i] : { from: i, to: i + 1 }; }
function chosen(flag, kept, n) { return flag ? kept : { v: n, w: n / 2 }; }
function sums(n) { let total = 0, names = ""; for (let i = -1; i < n; i++) { const part = partOf(i); total += part.size; if (part.tags) names += part.name + part.tags.length; } return total + names; }
function spans(list, n) { let out = 0; for (let i = 0; i < n; i++) { const { from, to } = spanOf(list, i); out += to - from + i; } return out; }
function choices(kept, n) { let out = 0; for (let i = 0; i < n; i++) { const each = chosen(i % 3 === 0, kept, i); out += each.v * 2 - each.w; if (each === kept) kept.v++; } return out + ":" + kept.v; }
function kept(n) { const all = []; for (let i = 0; i < n; i++) { const part = partOf(i); if (i & 1) all.push(part); part.size += 0; } return all.map(part => part.name + part.size + Object.keys(part).join("")).join(); }
for (let k = 0; k < 80; k++) { sums(8); spans([{ from: 1, to: 5 }, { from: 2, to: 3 }], 6); choices({ v: 1, w: 2 }, 9); kept(6); }
console.log(sums(0), sums(8), spans([], 4), spans([{ from: 1, to: 5 }, { to: 3, from: 2 }], 6), choices({ v: 1, w: 2 }, 9), choices({ w: 0.5, v: -1, x: 3 }, 4), kept(7));
console.log(spans([{ from: "1", to: "4" }, { to: 2 }, Object.create({ from: 0, to: 9 })], 4), choices({ v: "2", w: null }, 3), choices({ get v() { return 5; }, set v(n) { this.w = n; }, w: 1 }, 7), sums(3));
for (const bad of [[null], [undefined, { from: 1, to: 2 }], [5]]) { try { console.log(spans(bad, 2)); } catch (error) { console.log(error.constructor.name); } } let order = ""; const loud = new Proxy({ from: 1, to: 2 }, { get(target, key) { order += key; return target[key]; } }); console.log(spans([loud, loud], 3), order); found.set(2, standing); standing.size = 0.5; console.log(sums(4), kept(4)); Object.freeze(standing); try { console.log(kept(3)); } catch (error) { console.log(error.constructor.name); }
