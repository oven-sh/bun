async function wide(a: number, b: number, c: string, d: number, e: number, f: number, g: string, h: number, i: number, j: number) { await a; const x = await narrow(a + b, d, e, f, h, i, j); return c + g + x; }
async function narrow(a: number, b: number, c: number, d: number, e: number, f: number, g: number) { await 0; return a + b * 2 + c * 3 + d / 2 + e + f + g; }
async function rest(...all: number[]) { await 0; return all.reduce((x, y) => x + y, 0); }
async function defaults(a: number, b = a + 1, { c = 2, d }: { c?: number; d: number } = { d: 4 }) { await a; return a + b + c + d; }
class Counter {
  #count = 0;
  static async make(n: number) { await n; return new Counter(); }
  async add(n: number) { await n; this.#count += n; return this.#count; }
  async #twice(n: number) { await this.add(n); return await this.add(n); }
  async run(n: number) { const a = await this.#twice(n); const b = await this.add(1); return a + b; }
  get value() { return this.#count; }
}
class Heir extends Counter { async add(n: number) { const x = await super.add(n); return x * 10; } }
async function main() {
  await 0;
  let text = "";
  for (let i = 0; i < 5; i++) {
    text += await wide(i, 1.5, "c", 2, 3, 4, "g", 5.25, 6, 7);
    text += " " + await rest(1, 2, 3, i) + " " + await defaults(i) + " " + await defaults(i, 2, { d: 9 });
    const counter = i & 1 ? await Counter.make(i) : new Heir();
    text += " " + await counter.run(i) + " " + counter.value + "\n";
  }
  console.log(text);
}
await main();
for (let i = 0; i < 3; i++) console.log(await wide(i, 1.5, "c", 2, 3, 4, "g", 5.25, 6, 7), await rest(1, 2, i));
