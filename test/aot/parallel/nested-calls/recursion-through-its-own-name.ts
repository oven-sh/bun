function outer(n: number) {
  const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
  const even = (k: number): boolean => (k === 0 ? true : odd(k - 1));
  const odd = (k: number): boolean => (k === 0 ? false : even(k - 1));
  const walk = (k: number): number => { function step() { return k > 0 ? walk(k - 1) + 1 : 0; } return step(); };
  return fact(n) + ":" + even(n) + ":" + odd(n) + ":" + walk(n);
}
console.log(outer(5), outer(4));
