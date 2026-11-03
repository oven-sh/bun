// Set for each with additions: compiled answers as plain.
const s = new Set([1]);
const seen = [];
s.forEach(v => {
  seen.push(v);
  if (v < 4) s.add(v + 1);
});
console.log(seen.join(), s.size);
