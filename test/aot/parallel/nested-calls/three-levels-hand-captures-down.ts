function top(seed: number) {
  let total = seed;
  return middle(3);
  function middle(k: number): number {
    let local = k;
    return low(1) + low(2) + sibling();
    function low(d: number): number { local += d; total += local; return other(d) + seed; }
    function other(d: number): number { return d * local; }
  }
  function sibling(): number { return total; }
}
console.log(top(10), top(20));
