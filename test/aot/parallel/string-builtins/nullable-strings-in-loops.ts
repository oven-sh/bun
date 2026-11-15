// Equality of strings beside undefined and null: flat strings, ropes, substrings, atoms, one cell, equal contents in two cells, strict and loose.
const T = JSON.parse("20") as number;
class Item { maybe: string | undefined; none: string | null; constructor(public name: string, i: number) { this.maybe = i % 3 ? name : undefined; this.none = i % 4 ? null : name; } }
const makers: (() => string[])[] = [
  () => ["alpha", "beta", "gamma", "alph", "alpha", "", "a", "b"], () => "alpha,beta,gamma,alph,alpha,,a,b".split(","), () => ["alpha", "beta", "alpha"].map(w => w.slice(0, 2) + w.slice(2)), () => { const all = "alphabetagammaalph".repeat(4); return [all.slice(0, 20), all.slice(18, 38), all.slice(18, 38), all.slice(1, 21), all.substring(5, 5)]; },
  () => ["ālpha", "ālpha", "alpha", "ā", "😀"], () => { const s = "same" + T; return [s, "same" + T, s, "same" + (T + 1)]; }, () => Object.keys({ alpha: 1, beta: 2, 7: 3 }), () => [1, 12, 1, 100].map(String),
];
for (let t = 0; t < T; t++) {
  const said: number[] = [];
  for (const make of makers) {
    const xs = make(), items = xs.map((x, i) => new Item(x, i + t)), wanted = xs[t % xs.length].slice(0, 1) + xs[t % xs.length].slice(1);
    if (t % 5 === 3) delete (xs as (string | undefined)[])[1];
    let strict = 0, loose = 0;
    for (let i = 0; i < xs.length + 1; i++) {
      if (xs[i] === wanted) strict++;
      if (xs[i] !== xs[i + 1]) strict += 10;
      if (wanted === xs[i - 1]) strict += 100;
    }
    for (const a of items) for (const b of items) {
      if (a.maybe === b.maybe) strict += 3;
      if (a.none === b.maybe) strict += 5;
      if (a.name === b.none) strict += 7;
      if (b.maybe !== a.name) strict += 11;
      if (a.maybe == b.none) loose++;
      if (a.none == b.none) loose += 10;
      if (a.name == b.maybe) loose += 100;
      if (b.none != a.maybe) loose += 1000;
    }
    said.push(strict, loose);
  }
  console.log(said.join());
}
