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
