// A sum of numbers with fractions, a largest value, and a finally that reads both.
function add(n) {
  let total = 0.5, most = 0, seen = "";
  try {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 20; j++) { total += j * 0.25; if (total > most) most = total; }
    }
  } finally {
    seen = total + "|" + most;
  }
  return seen;
}
console.log([0, 1, 3, 50].map(add).join(" "));
