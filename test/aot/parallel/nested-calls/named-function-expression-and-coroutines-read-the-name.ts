function outer(n: number) {
  const named = function self(k: number): number { return k <= 0 ? 0 : 1 + self(k - 1); };
  const gen = function* () { yield n; yield n + 1; };
  const later = async () => n * 2;
  return later().then(v => named(n) + ":" + [...gen()].join("") + ":" + v);
}
outer(3).then(console.log);
