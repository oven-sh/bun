// A built-in object gets a property of its own that changes what the language does with it. The store stands in one place and runs many times, each time on a new object.
function store(object, name, value) { object[name] = value; }
function storeConstructor(object, value) { object.constructor = value; }
function storeThen(object, value) { object.then = value; }
function storeJoin(object, value) { object.join = value; }
function storeIterator(object, value) { object[Symbol.iterator] = value; }
function storeSpreadable(object, value) { object[Symbol.isConcatSpreadable] = value; }
function storeNext(object, value) { object.next = value; }
function storeToString(object, value) { object.toString = value; }
function storeValueOf(object, value) { object.valueOf = value; }
function storeExec(object, value) { object.exec = value; }
function storeSet(object, value) { object.set = value; object.add = value; }
class Other extends Array {}
const lines = [];
function* nine() { yield 9; }
for (let turn = 0; turn < 8; turn++) {
  const row = [];
  let a = [1, 2, 3]; storeConstructor(a, Other);
  row.push(a.slice() instanceof Other, a.slice(1) instanceof Other, a.map(x => x) instanceof Other, a.filter(x => x) instanceof Other, a.concat([4]) instanceof Other, a.splice(0, 1) instanceof Other, a.flat() instanceof Other);
  a = [1.5, 2.5]; storeConstructor(a, { [Symbol.species]: Other }); row.push(a.slice() instanceof Other, a.map(x => x) instanceof Other);
  a = [1, 2, 3]; storeIterator(a, nine); { const [first] = a; row.push([...a].join(), first, Array.from(a).join(), Math.max(...a), new Set(a).size); let sum = 0; for (const x of a) sum += x; row.push(sum); }
  a = [1, 2, 3]; store(a, Symbol.iterator, nine); row.push([...a].join());
  a = [1, 2, 3]; storeSpreadable(a, false); row.push([0].concat(a).length);
  a = [1, 2, 3]; storeJoin(a, () => "joined"); row.push(String(a), `${a}`, a + "");
  a = [1, 2, 3]; storeToString(a, () => "text"); row.push(String(a), `${a}`, a + "");
  a = [1, 2, 3]; storeValueOf(a, () => 7); row.push(a + 1, a * 2);
  a = ["x"]; store(a, "constructor", Other); row.push(a.slice() instanceof Other);
  const it = [1, 2][Symbol.iterator](); storeNext(it, () => ({ done: true })); row.push([...it].length);
  const re = /a/g; storeExec(re, () => null); row.push(re.test("a"), "aaa".replace(re, "b"), "a".match(re), "a".search(re));
  const m = new Map([[1, 2]]); storeIterator(m, nine); try { row.push(new Map(m).size); } catch (error) { row.push(error.constructor.name); } row.push([...m].join());
  const s = new Set([1, 2]); storeIterator(s, nine); row.push(new Set(s).size, [...s].join());
  const text = new String("ab"); storeIterator(text, nine); row.push([...text].join());
  const d = new Date(0); storeValueOf(d, () => 5); storeToString(d, () => "date"); row.push(d - 0, d + "", `${d}`);
  const n = new Number(1); storeValueOf(n, () => 5); row.push(n + 1);
  const f = function () {}; storeToString(f, () => "fn"); row.push(f + "");
  const e = new Error("m"); storeToString(e, () => "err"); row.push(e + "");
  lines.push(row.join(" "));
}
const order = [];
async function waits(turn) {
  const p = Promise.resolve(turn); storeConstructor(p, function NotPromise() {}); storeThen(p, function (resolve) { order.push("then " + turn); resolve("own " + turn); });
  order.push(await p);
  const q = Promise.resolve(turn); storeThen(q, function (resolve) { order.push("then of q " + turn); resolve("own q " + turn); });
  order.push(await q, await Promise.resolve(q), (await Promise.all([q]))[0], await (async () => q)());
}
(async () => { for (let turn = 0; turn < 8; turn++) await waits(turn); console.log(lines.join("\n")); console.log(order.join("\n")); })();
