// Objects in objects, made when they are missing, with counters at both levels
function index(rows) {
  const out = { n: 0 };
  for (let i = 0; i < rows.length; i++) {
    const [first, second] = rows[i];
    const inner = out[first] || (out[first] = { n: 0, list: [] });
    inner.n++;
    out.n += inner.n;
    for (const letter of second) {
      inner[letter] = (inner[letter] | 0) + 1;
      if (inner[letter] === 2) inner.list.push(letter + i);
    }
  }
  return JSON.stringify(out);
}
console.log(index([["p", "abca"], ["q", "zz"], ["p", "ab"]]));
console.log(index([[1, "x"], [1.5, "xyx"], ["1", "x"]]));
console.log(index([]), index([["n", "q"]]));
