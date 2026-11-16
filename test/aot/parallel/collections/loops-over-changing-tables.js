// Loops over sets, maps and others while they change.
// STATISTIC: IteratorsSteppedWithoutCall >= 20
const all = process.argv[2] === "all"; let lines = 0, hash = 0, log = ""; const more = process.argv.length > 90 ? 1 : 0;
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line.slice(0, 260)); else if (lines % 23 === 0) console.log(lines, hash); }
function show(x) { return Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : typeof x === "symbol" ? "symbol" : typeof x === "function" ? "function" : Array.isArray(x) ? "[" + x.map(show).join() + "]" : typeof x === "object" && x ? (x.id !== undefined ? "#" + x.id : x.constructor?.name + "{}") : String(x); }
class OwnSet extends Set { values() { log += "v"; return ["s", 5].values(); } [Symbol.iterator]() { log += "i"; return super.values(); } }
class HeirSet extends Set { extra = 1; }
class HeirMap extends Map { extra = 1; }
class OwnMap extends Map { keys() { log += "k"; return [7, 8].values(); } entries() { log += "e"; return super.entries(); } }
class Steps { at = 0; next() { log += "n"; return { done: this.at > 2, value: this.at++ }; } return() { log += "r"; return {}; } [Symbol.iterator]() { return this; } values() { return this; } keys() { return this; } entries() { return this; } }
const objects = [{ id: 1 }, { id: 2 }, { id: 3 }];
const CONST = new Set(["a", "b", "c", 4]);
function deletedFront(n, k) { const s = new Set(); for (let i = 0; i < n; i++) s.add(i); for (let i = 0; i < k; i++) s.delete(i); return s; }
const makers = {
  ints: () => new Set([3, 1, 2]), one: () => new Set([9]), none: () => new Set(), texts: () => new Set(["x", "y", "a long text"]), mixed: () => new Set([0.5, "t", null, undefined, true, NaN, -0, 1n, Symbol.iterator]), undef: () => new Set([undefined, 1]),
  objects: () => new Set(objects), doubles: () => new Set([0.25, 1.5, 2 ** 40, -1e300]), big: () => new Set(Array.from({ length: 300 }, (_, i) => i)), bigTexts: () => new Set(Array.from({ length: 70 }, (_, i) => "k" + i)),
  deleted1: () => deletedFront(4, 1), deleted: () => deletedFront(64, 50), deletedAll: () => deletedFront(64, 64), deletedMost: () => deletedFront(200, 199), cleared: () => { const s = new Set([1, 2]); s.clear(); return s; }, refilled: () => { const s = new Set([1, 2]); s.clear(); s.add("z"); s.add("y"); return s; },
  again: () => { const s = new Set([1, 2, 3]); s.delete(1); s.add(1); return s; }, middle: () => { const s = new Set([1, 2, 3, 4]); s.delete(2); s.delete(3); return s; }, constant: () => new Set(CONST), module: () => CONST, copy: () => new Set(new Set([5, 6])), union: () => new Set([1]).union(new Set([2])),
  grown: () => { const s = new Set(); for (let i = 0; i < 40; i++) { s.add(i); if (i > 8) s.delete(i - 8); } return s; }, frozen: () => Object.freeze(new Set([1, 2])), named: () => Object.assign(new Set([4, 5]), { name: 1 }),
  own: () => new OwnSet([1, 2]), heir: () => new HeirSet([1, 2, 3]), ownIterator: () => Object.assign(new Set([1, 2]), { [Symbol.iterator]() { log += "o"; return [7, 8][Symbol.iterator](); } }), ownValues: () => Object.assign(new Set([1, 2]), { values() { log += "w"; return ["ow"].values(); } }),
  proto: () => Object.setPrototypeOf(new Set([1, 2]), { [Symbol.iterator]() { return ["p"][Symbol.iterator](); }, values() { return ["pv"].values(); }, keys() { return ["pk"].values(); }, entries() { return [["pe", 1]].values(); }, delete: () => true, size: 2, add() {}, clear() {} }),
  noProto: () => Object.setPrototypeOf(new Set([1, 2]), null), sameProto: () => Object.setPrototypeOf(new Set([6, 7]), Object.create(Set.prototype)), proxy: () => new Proxy(new Set([1, 2]), {}), bound: () => { const s = new Set([1, 2]); return new Proxy(s, { get: (t, k) => { log += "g"; const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } }); },
  map: () => new Map([[1, "one"], ["two", 2], [null, 3]]), emptyMap: () => new Map(), bigMap: () => new Map(Array.from({ length: 50 }, (_, i) => [i, "v" + i])), heirMap: () => new HeirMap([[1, 2], [3, 4]]), ownMap: () => new OwnMap([[1, 2], [3, 4]]), deletedMap: () => { const m = new Map([[1, 2], [3, 4], [5, 6]]); m.delete(1); return m; },
  list: () => [5, 6, , 8], emptyList: () => [], doublesList: () => [0.5, NaN], view: () => new Int8Array([4, 5]), text: () => "h\\u{1F600}i", arguments: () => (function (..._) { return arguments; })(1, 2), steps: () => new Steps(), generator: () => (function* () { log += "y"; yield 1; try { yield 2; yield 3; } finally { log += "f"; } })(),
  iterator: () => new Set([1, 2, 3]).values(), mapIterator: () => new Map([[1, 2]]).entries(), weak: () => new WeakSet(), nothing: () => undefined, nil: () => null, number: () => 5, object: () => ({}), noMethod: () => ({ [Symbol.iterator]: 5 }), badNext: () => ({ [Symbol.iterator]() { return { next: 5 }; } }), badResult: () => ({ [Symbol.iterator]() { return { next() { return 5; } }; } }),
  thrower: () => ({ [Symbol.iterator]() { throw new RangeError("open"); } }), nextThrower: () => ({ [Symbol.iterator]() { return { next() { throw new RangeError("next"); }, return() { log += "R"; return {}; } }; } }), search: () => new URLSearchParams("a=1&b=2"), headers: () => new Headers({ a: "1" }),
};
function all_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) s.push(show(v)); return s; }
function sum_(box) { const m = box.m; if (m === 77) return m; let n = 0; for (const v of m) n += +(typeof v === "number" ? v : 1); return n; }
function count_(box) { const m = box.m; if (m === 77) return m; let n = 0; for (const v of m) n++; return n; }
function left_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) { s.push(show(v)); if (s.length === 2) break; } return s; }
function returned_(box) { const m = box.m; if (m === 77) return m; for (const v of m) if (v === 2 || v === "y") return "found"; return "no"; }
function thrown_(box) { const m = box.m; if (m === 77) return m; const s = []; try { for (const v of m) { s.push(show(v)); if (s.length === 2) throw new RangeError("t"); } } catch (e) { s.push(e.constructor.name); } return s; }
function continued_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) { if (v === 2 || v === "x") continue; s.push(show(v)); } return s; }
function finally_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) { try { if (v === 1) continue; s.push(show(v)); if (v === 3) break; } finally { s.push("f"); } } return s; }
function nested_(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; for (const v of m) for (const w of m) { s.push(show(v) + show(w)); if (n++ > 40) return s; } return s; }
function labeled_(box) { const m = box.m; if (m === 77) return m; const s = []; outer: for (const v of m) for (const w of m) { if (w === 2) continue outer; s.push(show(v) + show(w)); if (s.length > 30) break outer; } return s; }
function deleting_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) { s.push(show(v)); m.delete(v); } return s.join() + m.size; }
function deletingNext_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) { s.push(show(v)); m.delete(2); m.delete("y"); m.delete(v); } return s.join() + m.size; }
function deletingAll_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) { s.push(show(v)); for (const w of [...(m)]) if (w !== v) m.delete(w); } return s.join() + m.size; }
function adding_(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; for (const v of m) { s.push(show(v)); if (n++ < 5) m.add("new" + n); if (n > 400) break; } return s.join() + m.size; }
function addingMany_(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; for (const v of m) { if (n++ === 1) for (let i = 0; i < 50; i++) m.add(i + 0.5); s.push(show(v)); if (n > 400) break; } return s.join() + m.size; }
function moving_(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; for (const v of m) { s.push(show(v)); if (n++ < 9) { m.delete(v); m.add(v); } } return s; }
function clearing_(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; for (const v of m) { s.push(show(v)); if (n++ === 1) m.clear(); } return s.join() + m.size; }
function refilling_(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; for (const v of m) { s.push(show(v)); if (n++ === 1) { m.clear(); m.add("c"); m.add("d"); } } return s.join() + m.size; }
function emptying_(box) { const m = box.m; if (m === 77) return m; const s = []; while (m.size) { for (const v of m) { s.push(show(v)); if (!m.delete(v)) return s; break; } if (s.length > 300) break; } return s; }
function growing_(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; for (const v of m) { s.push(show(v)); if (n++ < 40) { m.delete(v); m.add("g" + n); m.add("h" + n); } if (n > 300) break; } return s.join() + m.size; }
function replaced_(box) { const m = box.m; if (m === 77) return m; const s = []; let t = m, n = 0; for (const v of t) { s.push(show(v)); if (n++ === 0) t = new Set(["T"]); } for (const v of t) s.push(show(v)); return s; }
function patched_(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; for (let i = 0; i < 3 + more; i++) for (const v of m) { s.push(show(v)); if (n++ === 1) (m)[Symbol.iterator] = function () { return ["P", "Q"][Symbol.iterator](); }; if (n > 50) return s; } return s; }
function protoChanged_(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; for (let i = 0; i < 3 + more; i++) for (const v of m) { s.push(show(v)); if (n++ === 1) Object.setPrototypeOf(m, { [Symbol.iterator]() { return ["R"][Symbol.iterator](); } }); if (n > 50) return s; } return s; }
function held_(box) { const m = box.m; if (m === 77) return m; const it = (m)[Symbol.iterator](); const s = []; for (const v of it) { s.push(show(v)); if (s.length > 1) break; } for (const v of it) s.push("|" + show(v)); for (const v of it) s.push("!" + show(v)); return s; }
function heldValues_(box) { const m = box.m; if (m === 77) return m; const it = m.values(); const s = []; s.push(show(it.next().value)); for (const v of it) s.push(show(v)); m.add("late"); s.push(it.next().done); for (const v of it) s.push("!" + show(v)); return s; }
function heldEntries_(box) { const m = box.m; if (m === 77) return m; const it = m.entries(); const s = []; for (const v of it) s.push(show(v)); return s; }
function ownNext_(box) { const m = box.m; if (m === 77) return m; const it = m.values(); it.next = function () { log += "N"; return { done: true, value: 1 }; }; const s = []; for (const v of it) s.push(show(v)); return s; }
function ownReturn_(box) { const m = box.m; if (m === 77) return m; const it = m.values(); it.return = function () { log += "R"; return {}; }; const s = []; for (const v of it) { s.push(show(v)); break; } return s; }
function two_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) { s.push(show(v)); if (s.length > 2) break; } for (const v of m) s.push(show(v)); return s; }
function values_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m.values()) s.push(show(v)); return s; }
function keys_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m.keys()) s.push(show(v)); return s; }
function entries_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const [a, b] of m.entries()) s.push(show(a) + show(b)); return s; }
function patterns_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const [a, b] of m) s.push(show(a) + show(b)); return s; }
function objects_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const { length } of m) s.push(show(length)); return s; }
function indexes_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) s.push(show(([7, 8, 9])[v])); return s; }
function closures_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) s.push(() => show(v)); return s.map(f => f()); }
function awaiting_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) { if (typeof v === "string") for (let i = 0; i < v.length; i++) s.push(v.charCodeAt(i)); } return s; }
function texts_(box) { const m = box.m; if (m === 77) return m; let s = ""; for (const v of m) s += show(v) + ","; return s; }
function generator_(box) { const m = box.m; if (m === 77) return m; const g = (function* () { for (const v of m) yield show(v); })(); const s = []; for (const v of g) { s.push(v); if (s.length === 4) break; } return s; }
function spread_(box) { const m = box.m; if (m === 77) return m; return [...m]; }
function spreadTwo_(box) { const m = box.m; if (m === 77) return m; return [0, ...m, ...m, 9]; }
function spreadIn_(box) { const m = box.m; if (m === 77) return m; let n = 0; const l = []; for (let i = 0; i < 3 + more; i++) { const t = [...m]; n += t.length; l.push(...t); m.add("s" + i); } return show(l) + n; }
function spreadDoubles_(box) { const m = box.m; if (m === 77) return m; const l = [0.5, 1.5]; l.push(...m); return l; }
function spreadCall_(box) { const m = box.m; if (m === 77) return m; return ((...a) => a)(...m); }
function spreadNew_(box) { const m = box.m; if (m === 77) return m; return [...new Set([...m, 1, 2])]; }
function from_(box) { const m = box.m; if (m === 77) return m; return Array.from(m); }
function fromMapped_(box) { const m = box.m; if (m === 77) return m; return Array.from(m, (v, i) => show(v) + i); }
function fromChanging_(box) { const m = box.m; if (m === 77) return m; let n = 0; return Array.from(m, (v) => { if (n++ < 3) { m.delete(v); m.add("f" + n); } return show(v); }); }
function fromClearing_(box) { const m = box.m; if (m === 77) return m; let n = 0; return Array.from(m, (v) => { if (n++ === 1) m.clear(); return show(v); }); }
function fromThrowing_(box) { const m = box.m; if (m === 77) return m; let n = 0; try { return Array.from(m, (v) => { if (n++ === 1) throw new RangeError("f"); return show(v); }); } catch (e) { return e.constructor.name + n; } }
function copied_(box) { const m = box.m; if (m === 77) return m; return [...new Set(m)]; }
function forEach_(box) { const m = box.m; if (m === 77) return m; const s = []; (m).forEach((v, k) => { s.push(show(v)); if (s.length === 1) (m).delete?.(v); }); return s; }
function collected_(box) { const m = box.m; if (m === 77) return m; const s = []; for (const v of m) { const l = []; for (let i = 0; i < 300; i++) l.push({ v, i }); s.push(show(v) + l.length); } return s; }
const names = { all: all_, sum: sum_, count: count_, left: left_, returned: returned_, thrown: thrown_, continued: continued_, finally: finally_, nested: nested_, labeled: labeled_, deleting: deleting_, deletingNext: deletingNext_, deletingAll: deletingAll_, adding: adding_, addingMany: addingMany_, moving: moving_, clearing: clearing_, refilling: refilling_, emptying: emptying_, growing: growing_, replaced: replaced_, patched: patched_, protoChanged: protoChanged_, held: held_, heldValues: heldValues_, heldEntries: heldEntries_, ownNext: ownNext_, ownReturn: ownReturn_, two: two_, values: values_, keys: keys_, entries: entries_, patterns: patterns_, objects: objects_, indexes: indexes_, closures: closures_, awaiting: awaiting_, texts: texts_, generator: generator_, spread: spread_, spreadTwo: spreadTwo_, spreadIn: spreadIn_, spreadDoubles: spreadDoubles_, spreadCall: spreadCall_, spreadNew: spreadNew_, from: from_, fromMapped: fromMapped_, fromChanging: fromChanging_, fromClearing: fromClearing_, fromThrowing: fromThrowing_, copied: copied_, forEach: forEach_, collected: collected_ };
function boxed(m) { const box = JSON.parse('{"m":0}'); box.m = m; return box; }
function run(name, f) { log = ""; let r; try { r = show(f()); } catch (e) { r = "! " + e?.constructor?.name + (e instanceof RangeError ? " " + e.message : ""); } say(name + " " + r + " " + log); }
function every(turn) { for (const maker of Object.keys(makers)) for (const name of Object.keys(names)) { if (maker === "module" && /delet|clear|adding|moving|refill|empty|grow|patched|proto|held|from|spreadIn|forEach/i.test(name)) continue; if (maker === "bigTexts" && /nested|collected/.test(name)) continue; run(turn + maker + " " + name, () => names[name](boxed(makers[maker]()))); } }
every("");
console.log("lines", lines, hash);
