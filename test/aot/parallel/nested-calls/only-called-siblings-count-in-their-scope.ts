function outer(a: number, b: number) {
  let n = 0;
  const r = first(a) + second(b);
  return r + n;
  function first(x: number): number { n++; return x > 0 ? second(x - 1) : a; }
  function second(y: number): number { n += 2; return y > 0 ? first(y - 1) : b; }
}
let total = 0;
for (let i = 0; i < 1000; i++) total += outer(i & 7, i & 3);
console.log(total);
