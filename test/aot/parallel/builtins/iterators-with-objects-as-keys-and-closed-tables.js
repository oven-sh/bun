// A Map whose keys are objects, its iterator stepped and returned; and an iterator that a spread has run to its end on one way, then walked by hand behind deletes.
function skipFirst(n) {
  const m = new Map();
  for (let i = 0; i < n; i++) m.set({ id: i }, "v" + i);
  const it = m.keys();
  it.next();
  return it;
}
console.log(skipFirst(3).next().value.id, skipFirst(process.argv.length + 3).next().value.id);
function cell(n) {
  const r = [];
  const c = new Map();
  for (let i = 0; i < 8; i++) c.set("i" + i, i);
  const it = c.entries();
  if (n % 3 === 0) r.push([...it].length);
  for (let g = 0; g < n; g++) c.delete("g" + g);
  for (let x = it.next(); !x.done; x = it.next()) r.push(String(x.value[0]));
  return r.join(",");
}
console.log(cell(3), cell(4), cell(process.argv.length));
function cellOfSet(n) {
  const r = [];
  const c = new Set();
  for (let i = 0; i < 8; i++) c.add("i" + i);
  const it = c.values();
  if (n % 3 === 0) r.push([...it].length);
  c.delete("i0");
  for (let x = it.next(); !x.done; x = it.next()) r.push(x.value);
  return r.join(",");
}
console.log(cellOfSet(3), cellOfSet(4), cellOfSet(process.argv.length));
