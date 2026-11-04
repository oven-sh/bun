function outer(seed: number) {
  let calls = 0;
  class Box {
    static made = helper(1);
    static { Box.made += helper(2); }
    value = helper(3);
    [key()] = 7;
    constructor(public extra: number = helper(4)) {}
    get twice() { return helper(this.value) * 2; }
    method(x: number) { return helper(x) + seed; }
    static build() { return new Box(); }
    arrow = () => helper(5);
  }
  const box = Box.build();
  return [Box.made, box.value, (box as any).k1, box.extra, box.twice, box.method(6), box.arrow(), calls].join(",");
  function helper(x: number): number { calls++; return x + seed; }
  function key(): string { return "k" + helper(0 - seed + 1); }
}
console.log(outer(10), outer(20));
