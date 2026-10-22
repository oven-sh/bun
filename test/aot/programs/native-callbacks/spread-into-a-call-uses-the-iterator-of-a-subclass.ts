// Sources of a spread: `f(...x)`, `[...x]`, `new Set(x)`, Array.from and Promise.all use the Symbol.iterator method of an Array subclass, which yields strings though the class says number.
export {};

let total = 0;

class Odd extends Array<number> {
  *[Symbol.iterator](): ArrayIterator<number> {
    total += 1;
    for (let i = 0; i < this.length; i++) yield (i % 2 ? String(this[i]) : this[i]) as number;
  }
}

function sum(a: number, b: number, c: number): number | string {
  total += (typeof a === "number" ? 100 : 10000) + (typeof b === "number" ? 100 : 10000) + (typeof c === "number" ? 100 : 10000);
  return a + b + c;
}

const odd = new Odd();
odd.push(1, 2, 3);
sum(1, 2, 3);
const results: unknown[] = [sum(...(odd as unknown as [number, number, number])), [...odd].map(one => typeof one), new Set(odd).has(2), Array.from(odd)[1] === 2, Math.max(...odd), ((await Promise.all(odd)) as any).map((one: unknown) => typeof one), Array.from(odd.concat([4]), one => typeof one).join("/")];
const [, second] = odd;
console.log(total, results.join(), typeof second);
