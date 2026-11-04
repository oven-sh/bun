function f(x) {
  let b = 3, a = x, c = x, fuel = 12;
  const T = [];
  do {
    if ((a !== c || [c].includes(c)) && typeof b !== "number") {
      b = c < 0 ? c : 2; T.push(b !== c);
    }
  } while (Number.isInteger(c) && fuel-- > 0);
  while (0 === b && fuel-- > 0) {
    if (b === null) c = c + "";
  }
  if (c >= a) { a += 1; }
  return [a, b, c, T.length].map(String).join();
}
for (const x of JSON.parse("[-1,5]")) console.log(f(x));
