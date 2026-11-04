function outer(seed: number) {
  const first = [...count(3)].join("");
  const it = count(2);
  return twice(seed).then(v => first + ":" + it.next().value + ":" + v + ":" + (count(1) === count(1)));
  function* count(n: number) { for (let i = 0; i < n; i++) yield i + seed; }
  async function twice(x: number) { await null; return x * 2; }
}
outer(1).then(console.log);
