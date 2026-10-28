// A parameter of type `unknown` is cast to a function type and called at once.
let n = 0;
let v: (fn: unknown) => void = fn => (fn as () => void)();
function viaCast(fn: unknown, k: number): void { if (k > 1e9) viaCast(fn, k - 1); (fn as () => void)(); }
function maker(k: number): number { //! frame
  let sum = k;
  const add = (): void => { sum += 2; }; //! frame
  viaCast(add, k);
  viaCast(add, k + 1);
  return sum;
}
let out = 0;
for (let i = 0; i < 50; i++) { v(() => { n += i; }); out += maker(i); }
if (n < 0) v = fn => { console.log(fn); };
console.log(n, out);
