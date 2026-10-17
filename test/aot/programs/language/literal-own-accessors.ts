// A typed read of an accessor that an object literal defines.
const round = 5;
const reads = {
  n: round,
  get twice() { return this.n * 2; },
  set twice(v: number) { this.n = v / 2; },
  get thrice() { return this.n * 3; },
};
reads.twice = 10;
console.log(reads.n, reads.twice, reads.thrice);
function area(o: { w: number; readonly h: number }) { return o.w * o.h; }
console.log(area({ w: 2, get h() { return 7; } }));
function make(k: number) { return { k, get label() { return "k" + this.k; } }; }
for (let i = 0; i < 3; i++) console.log(make(i).label);
const lazy = { get schema() { return { a: 1 }; } };
console.log(lazy.schema.a, "schema" in lazy, Object.keys(lazy).join());
