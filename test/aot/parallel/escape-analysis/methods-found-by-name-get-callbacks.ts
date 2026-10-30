// The method is read by name from an object whose class is not known where the call stands: own fields, prototype methods, getters, static members, built-in methods of arrays, maps, sets, strings and promises.
interface Each { each(f: (v: number) => number): number }
const kept: Array<(v: number) => number> = [];
class Borrower implements Each { each(f: (v: number) => number) { return f(1) + f(2); } }
class Keeper implements Each { each(f: (v: number) => number) { kept.push(f); return f(3); } }
class ByGetter implements Each { get each() { return (f: (v: number) => number) => f(4); } }
class ByField implements Each { each = (f: (v: number) => number) => { kept.push(f); return f(5); }; }
const literal: Each = { each(f) { return f(6); } };
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "") as <T>(list: T[], i: number) => T;
const all: Each[] = [new Borrower(), new Keeper(), new ByGetter(), new ByField(), literal];
let sum = 0;
for (let i = 0; i < 2000; i++) sum += pick(all, i % all.length).each(v => v * i);
console.log(sum, kept.length, kept.reduce((a, f) => a + f(1), 0));

const things: any[] = [[3, 1, 2], new Map([[1, 2], [3, 4]]), new Set([5, 6]), new Int32Array([9, 8, 7])];
const out: string[] = [];
for (let i = 0; i < 400; i++) {
  const thing = pick(things, i % things.length), k = i;
  let n = 0;
  thing.forEach((v: number) => { n += v + k; });
  out.push(String(n));
  if (i % things.length === 0 || i % things.length === 3) {
    out.push(String(thing.map((v: number) => v + k)), String(thing.filter((v: number) => v > 1 + (k & 1))), String(thing.some((v: number) => v === k)), String(thing.every((v: number) => v < k)),
      String(thing.find((v: number) => v === 2)), String(thing.findIndex((v: number) => v === 2)), String(thing.reduce((a: number, v: number) => a + v * k, 0)), String(thing.slice().sort((a: number, b: number) => (a - b) * (k & 1 ? 1 : -1))));
  }
}
console.log(out.length, out.join("|").length, out.slice(0, 24).join("|"));
const texts: any[] = ["banana", "cabbage"];
console.log(pick(texts, 0).replace(/a/g, (m: string) => m + sum), pick(texts, 1).replaceAll("b", (m: string) => m.toUpperCase()));
const promises: any[] = [Promise.resolve(1), Promise.reject(2)];
Promise.all([pick(promises, 0).then((v: number) => v + sum), pick(promises, 1).then(null, (v: number) => v + sum), pick(promises, 0).finally(() => { sum++; })]).then(r => console.log(r.join(), sum));
