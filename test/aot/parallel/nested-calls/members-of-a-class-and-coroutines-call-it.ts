function outer(seed: number) {
  let calls = 0;
  const helper = (x: number): number => { calls++; return x + seed; };
  class Box {
    static made = helper(1);
    value = helper(2);
    get twice() { return helper(this.value) * 2; }
    method(x: number) { return helper(x); }
  }
  function* steps() { yield helper(3); yield helper(4); }
  const later = async () => { const a = helper(5); await null; return a + helper(6); };
  const box = new Box();
  const all = [...steps()];
  return later().then(v => [Box.made, box.value, box.twice, box.method(7), all.join("|"), v, calls].join(","));
}
outer(10).then(console.log);
