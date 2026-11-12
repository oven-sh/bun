// Maps and sets whose keys are whole numbers: added in order from zero, out of order, with gaps, deleted and added again, beside other keys, negative, large, and fractions that are whole.
const lines = [];
function report(name, ...values) {
  lines.push(name + ": " + values.map(String).join(" "));
}
function sums(map, set, first, last) {
  let found = 0, total = 0, members = 0;
  for (let i = first; i < last; i++) {
    if (map.has(i)) found++;
    const value = map.get(i);
    if (value !== undefined) total += typeof value === "number" ? value : value.length;
    if (set.has(i)) members++;
  }
  return found + "/" + total + "/" + members;
}
function filled(keys, valueOf) {
  const map = new Map(), set = new Set();
  for (const key of keys) {
    map.set(key, valueOf(key));
    set.add(key);
  }
  return [map, set];
}
const inOrder = (n) => Array.from({ length: n }, (_, i) => i);
for (const size of [0, 1, 3, 4, 5, 8, 9, 60, 254, 260, 1200]) {
  for (const [name, keys] of [["order", inOrder(size)], ["backwards", inOrder(size).reverse()], ["from one", inOrder(size).map((i) => i + 1)], ["even", inOrder(size).map((i) => 2 * i)], ["around zero", inOrder(size).map((i) => i - (size >> 1))], ["texts between", inOrder(size).map((i) => (i % 3 ? i : "t" + i))], ["fractions between", inOrder(size).map((i) => (i % 4 ? i : i + 0.5))]]) {
    const [map, set] = filled(keys, (key) => (typeof key === "number" ? key * 2 + 1 : "text"));
    report(name + " " + size, sums(map, set, -3, size + 4));
  }
}
const [changed, members] = filled(inOrder(40), (i) => "v" + i);
let text = "";
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 44; i++) {
    const value = changed.get(i);
    text += value === undefined ? "." : typeof value === "string" ? value.length : value;
    if (members.has(i)) text += "+";
  }
  if (round === 0) for (let i = 0; i < 40; i += 5) changed.delete(i), members.delete(i);
  if (round === 1) for (let i = 35; i >= 0; i -= 5) changed.set(i, i & 7), members.add(i);
  if (round === 2) changed.clear(), members.clear();
  if (round === 3) for (let i = 0; i < 10; i++) changed.set(i, undefined), members.add(9 - i);
  if (round === 4) changed.set("text", 1), changed.set(3, 2.5), members.add({});
}
report("changed", text);
const odd = new Map([[0, "zero"], [1, "one"], [2, "two"]]);
function oddKeys(keys) {
  const found = [];
  for (const key of keys) {
    const whole = key | 0;
    found.push(odd.get(key), odd.get(whole), odd.has(key), odd.get(-whole), odd.get(whole + 4294967296));
  }
  return found.join();
}
report("odd", oddKeys([0, -0, 1, 1.0, 2.5, NaN, 4294967296, -1, "1", 2 ** 31, -(2 ** 31)]));
function lists(turns) {
  const map = new Map();
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    const list = map.get(turn & 7);
    if (list) {
      list.push(turn);
      if (list.length > 4) list.length = 0;
      total += list.length;
    } else map.set(turn & 7, [turn]);
    total += map.size;
  }
  return total;
}
report("lists", lists(200));
function memo(n) {
  const known = new Map();
  for (let i = 0; i <= n; i++) known.set(i, i < 2 ? i : (known.get(i - 1) + known.get(i - 2)) % 1000003);
  return known.get(n);
}
report("memo", memo(1), memo(10), memo(500));
console.log(lines.join("\n"));
