function outer(n: number) {
  const named = function self(k: number): unknown { return k <= 0 ? self === named : self(k - 1); };
  return named(n) + ":" + named.name;
}
console.log(outer(2));
