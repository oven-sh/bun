function changed(before, after) {
  const out = [];
  for (const key of Object.keys({ ...before, ...after })) {
    if (before[key] !== after[key]) out.push(key);
  }
  return out;
}
console.log(changed({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, d: 4 }).join());
