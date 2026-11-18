let log = "";
const holed = collection => (collection.delete(1), collection);
const map = () => holed(new Map([[1, 2], [3, 4], ["a", 5]]));
const set = () => holed(new Set([1, 2, "a"]));
const iterables = () => [
  [], [1, 2, 3], [1.5, , 2.5], ["a", [1], 3], new Array(2), [[1, 2], [3]], Object.assign([1, 2], { x: 1 }),
  Object.defineProperty([1, 2, 3], 1, { get: () => ((log += "g"), 9) }), "", "a😀b\ud83d", "xabc".substring(1),
  new Map(), map(), new Set(), set(), map().keys(), map().values(), map().entries(), set().values(), set().entries(),
  [1, 2].keys(), [1, , 2].values(), ["a"].entries(), new Uint8Array([1, 2]), new Float64Array([0.5]),
  new Uint8Array(new ArrayBuffer(2, { maxByteLength: 8 })), (function* () { try { yield 1; yield 2; } finally { log += "c"; } })(),
  1, {},
].map(a => [a]);

for (const body of [
  "for (const x of a) r.push(x);", "for (const x of a) { r.push(x); break; } r.push([...a]);", "for (const x of a) throw x;",
  "for (const [k, v] of a) r.push(k, v);", "for (const x of a) for (const y of a) r.push(y);",
  "const [x, , y, z = 4, ...rest] = a; r.push(x, y, z, rest);", "let [x, y] = a; [x, y] = [y, x]; r.push(x, y);",
  "for (const x of a) if (r.push(x) < 3) a.push?.(0.5);", "for (const x of a) { r.push(x); if (a.pop) a.length = 1; a.clear?.(); }",
  "for (const x of a) if (r.push(x) < 3) for (let i = 0; i < 9; i++) (a.add ?? (a.has && a.set))?.call(a, r.length * 9 + i);",
  "for (const x of a) { r.push(x); a.delete?.(3); a.delete?.(2); }", "for (const x of a) { r.push(x); a.buffer?.transfer(); }",
  "for (const x of a) { r.push(x); if (a.buffer?.resizable) a.buffer.resize(r.length == 1 ? 4 : 3); }",
  "for (const x of a) { if (a.next) a.return = () => ((log += 'r'), {}); break; }",
]) {
  const f = `a => { const r = []; log = ""; ${body} return [r, log]; }`;
  check(f, iterables);
  checkInTurn(f, iterables, 6);
}
checkInTurn(a => { let n = 0; for (const x of a) n++; return n; }, () => [[Array(300).fill(1)], ["ab".repeat(200)], [new Set(Array(100).keys())]], 3);

const pristine = { on: false };
const leave = it => { for (const x of [1, 2]) { if (it.on) Object.getPrototypeOf([].values()).return = () => ((log = "late"), {}); break; } };
for (let turn = 0; turn < 100; turn++) leave(pristine);
leave({ on: true });
if (log !== "late") throw new Error("not closed");
