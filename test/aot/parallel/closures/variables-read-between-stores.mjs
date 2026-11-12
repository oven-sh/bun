// Closures read a variable between two stores into it: the first store stays.
function either(list) {
  let sum = 0;
  const seen = [];
  let get = () => sum;
  for (const item of list) { if (item > 2) get = () => seen.length; }
  while (sum < 10) { sum += 2; sum += get(); }
  return sum;
}
function chosen(list) { let sum = 0; const get = list.length & 1 ? () => sum : () => list.length; for (let i = 0; i < 4; i++) { sum += 3; sum += get(); } return sum; }
function ofMap(list) { let sum = 1; const table = new Map([[0, () => sum], [1, () => sum * 2]]); for (let i = 0; i < 5; i++) { sum += 1; sum = table.get(list.length & 1)() + 1; } return sum; }
function returned(list) { let sum = 2; const make = n => (n ? () => sum : () => -sum); const get = make(list.length); let i = 0; while (i++ < 5) { sum += 4; sum = sum + get(); if (sum > 90) sum = 1; } return sum; }
function ofFields(list) { let sum = 0; const holder = { a: () => sum, b: () => sum + 1 }; const out = []; for (let i = 0; i < 4; i++) { sum = 7; sum = holder.a() + i; out.push(sum); sum += 1; sum = holder.b() - list.length; out.push(sum); } return out.join(); }
function throughHelper(list) { let sum = 0; const call = get => get(); const read = () => sum; for (const item of [1, 2, 3, ...list]) { sum += item; sum += call(read); } return sum; }
function inFinally(list) { var sum = 0, guard = 0; let get = x => sum + (x | 0); get = list.length % 3 ? get : x => sum + (x | 0); while (sum < 40 && guard++ < 12) { sum -= 1; try { sum += get(); } finally { sum += 1; } sum = 5; sum = get() + 1; } return sum; }
function nested(list) { let sum = 0; const read = () => sum; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { sum += j; sum = read() + i; } sum = 1; sum = 2; sum += read(); } return sum + list.length; }
function callbacks(list) { let sum = 0; const read = () => sum; [3, 1, 2].forEach(item => { sum += item; sum += read(); }); const squares = list.map(item => { sum = item; sum = read() * item; return sum; }); return sum + ":" + squares.join(); }
function late(list) { let held = 0; let sum = 0; const read = () => sum; for (let i = 0; i < 6; i++) { sum = i; const between = read(); sum = i + 1; if (i % 2 === list.length % 2) held += between; } return held + sum; }
function phi(list) { let sum = 0; const read = () => sum; let last = -1; for (let i = 0; i < 6; i++) { sum = i * 2; const between = read(); sum = -i; last = list.length > i ? between : last; } return last + sum; }
async function waits(list) { let sum = 0; const read = () => sum; for (let i = 0; i < 3; i++) { sum += 1; const between = read(); sum += 1; await null; sum += between; } return sum + list.length; }
function* steps(list) { let sum = 0; const read = () => sum; for (let i = 0; i < 3; i++) { sum += 1; const between = read(); sum = between * 2; yield sum; sum += 1; sum += read(); } yield list.length; }
let module = 0; const ofModule = () => module;
function modules(list) { for (let i = 0; i < 4; i++) { module += 1; const between = ofModule(); module = between * 2; } return module + list.length; }
const random = (() => { let seed = 49734321; return () => { seed = (seed + 0x7ed55d16 + (seed << 12)) & 0xffffffff; seed = (seed ^ 0xc761c23c ^ (seed >>> 19)) & 0xffffffff; seed = (seed + 0x165667b1 + (seed << 5)) & 0xffffffff; return (seed & 0xfffffff) / 0x10000000; }; })();
for (const list of [[], [1], [3], [1, 2], [0, 3, 4], [5, 1, 2, 3]]) {
  console.log(either(list), chosen(list), ofMap(list), returned(list), ofFields(list), throughHelper(list), inFinally(list), nested(list), callbacks(list), late(list), phi(list), [...steps(list)].join(), modules(list));
  let total = 0; for (let i = 0; i < 20; i++) total += random(); console.log(total.toFixed(6), await waits(list));
}
