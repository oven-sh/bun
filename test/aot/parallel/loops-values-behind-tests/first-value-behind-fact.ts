// An object made in a counted loop is carried out of it in parts, into a second loop whose head tests it. The test of the first value went in front of that loop without the cast that says the word is filled: the build's own verifier stopped behind ConvertCountersToIntegers.
function k1(y: any, n: number): any {
  let b: any = 0;
  while (y !== y) y = [y] as any;
  while (n !== n) n = [n] as any; if (y !== b) {
    [b, y] = [y, b];
    let r = y; while (r !== r) r = [r] as any; for (let i = 0; i < n; i++) r = { v: i + 0.5 }; while (r !== r) r = [r] as any; return r === null ? -1 : r === undefined ? -2 : r.v;
  }
  return b;
}
console.log(k1(null, 1), k1(1.5, 1));
