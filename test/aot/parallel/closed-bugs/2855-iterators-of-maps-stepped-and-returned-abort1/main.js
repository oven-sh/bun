function skipFirst(n) {
  const m = new Map();
  for (let i = 0; i < n; i++) m.set({ id: i }, "v" + i);
  const it = m.keys();
  it.next();
  return it;
}
console.log(skipFirst(3).next().value.id, skipFirst(process.argv.length + 3).next().value.id);
