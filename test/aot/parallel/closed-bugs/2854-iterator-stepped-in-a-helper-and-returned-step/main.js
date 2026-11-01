function skipFirst(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i);
  const it = a.values();
  it.next();
  return it;
}
console.log(skipFirst(3).next().value, skipFirst(process.argv.length + 3).next().value);
