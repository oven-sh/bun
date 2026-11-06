// For in with changes: compiled answers as plain.
const o = { a: 1, b: 2, c: 3 };
const seen = [];
for (const k in o) {
  seen.push(k);
  if (k === "a") {
    delete o.b;
    o.d = 4;
  }
}
console.log(seen.join());
