// STATISTIC: NestedLoopCounterGuardsHoisted = 0
const rounds = +process.argv[2]! || 3;
class Sum {
  a = 1; b = 0;
  update(data: ArrayLike<number>, start: number, end: number): this {
    let { a, b } = this;
    let i = start;
    while (i < end) {
      const stop = Math.min(i + 16, end);
      for (; i < stop; i++) { a += data[i]!; b += a; }
      a %= 65521; b %= 65521;
    }
    this.a = a; this.b = b;
    return this;
  }
}
const bytes = new Uint8Array(70);
for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) ^ (i >> 2);
const kinds: ArrayLike<number>[] = [bytes, Array.from(bytes), new Float64Array(bytes), "0123456789" as unknown as ArrayLike<number>];
const cuts: number[] = JSON.parse("[0,70,3,41,0.5,9,-2,4,60,90]");
const out: string[] = [];
for (let r = 0; r < rounds; r++) for (const data of kinds) for (let c = 0; c + 1 < cuts.length; c += 2) { const s = new Sum().update(data, cuts[c]!, cuts[c + 1]!); out.push(String(s.a) + "," + String(s.b)); }
console.log(out.join(" "));
