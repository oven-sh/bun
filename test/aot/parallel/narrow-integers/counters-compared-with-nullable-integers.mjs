const out = [];
class Counter { constructor() { this.count = -9007199254740992; this.low = 2147483600; this.high = 7; this.list = [1, 2, 3]; this.flag = false; this.other = undefined; this.limit = undefined; } reset() { this.limit = 9007199254740992; } bound() { return this.flag ? undefined : this.limit; } grow(i) { this.limit = 9007199254740992; this.other = 5; this.low = (this.low + 3) | 0; } step(i) { let total = 0; { if (this.count < this.limit && this.count >= this.limit) total += 3; else total += 7; } { total += ++this.count > this.limit || ++this.count <= this.limit ? 1 : 10; } { if (this.limit <= this.count) total += 11; else total -= 1; } { if (++this.count !== this.limit) out.push("y" + i); else out.push("n" + i); } return total; } }
function run() { const c = new Counter(); let all = 0;
  for (let i = 0; i < 40; i++) { if (i % 9 === 4) c.limit = 5; if (i % 11 === 6) c.limit = undefined; if (i % 7 === 5) c.grow(i); all += c.step(i); if (i % 13 === 12) c.count = 9007199254740989; }
  out.push(all, c.count, c.limit, c.other); }
for (let r = 0; r < 3; r++) run();
console.log(out.join());
// -9007199254740992 undefined ['9007199254740992', '5'] ++this.count this.limit ['both', 'either', 'swap', 'branch'] ctor
