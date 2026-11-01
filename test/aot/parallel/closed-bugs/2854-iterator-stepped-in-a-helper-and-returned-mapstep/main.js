function skipTwo(n) {
  const m = new Map();
  for (let i = 0; i < n; i++) m.set(i, "v" + i);
  const it = m.keys();
  it.next();
  it.next();
  return it;
}
console.log([...skipTwo(4)].join(","), [...skipTwo(process.argv.length + 2)].join(","));
