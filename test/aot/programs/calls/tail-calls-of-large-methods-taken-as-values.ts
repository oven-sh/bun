// Typed methods that are also taken as values, so that a call of the closure first tests the arguments, and that are too large to be copied into that test. `this` is not tested: another object takes the generic path.
// Each ends in a call of a function kept in a field. Chains of any length run in constant space, whoever starts them.
const lines: string[] = [];
function say(...parts: unknown[]): void { lines.push(parts.map(part => (typeof part === "object" && part !== null ? JSON.stringify(part) : String(part))).join(" ")); }
const deep = 300000;

class Walker {
  hop: (this: Walker, n: number, acc: number) => number;
  weights: number[] = [1, 2, 3, 4];
  constructor(other: boolean) { this.hop = other ? this.stride : this.step; }
  step(n: number, acc: number): number {
    if (n === 0) return acc + 0.5;
    let extra = 0;
    if (n % 100000 === 0) {
      for (let i = 0; i < this.weights.length; i++) extra += this.weights[i] * (i + 1);
      for (let i = 0; i < this.weights.length; i++) extra -= this.weights[i] * i;
      for (const weight of this.weights) extra += weight > 2 ? weight : -weight;
      for (const weight of this.weights) extra -= weight > 2 ? weight : -weight;
    }
    return this.hop(n - 1, acc + 1 + extra);
  }
  stride(n: number, acc: number): number {
    if (n === 0) return acc - 0.5;
    let extra = 0;
    if (n % 100000 === 0) {
      for (let i = 0; i < this.weights.length; i++) extra += this.weights[i] * (i + 2);
      for (let i = 0; i < this.weights.length; i++) extra -= this.weights[i] * i;
      for (const weight of this.weights) extra += weight > 1 ? weight : -weight;
      for (const weight of this.weights) extra -= weight > 1 ? weight : -weight;
    }
    return this.hop(n - 1, acc + 2 + extra);
  }
}
const walkers = [new Walker(false), new Walker(true)];
for (const walker of walkers) say(walker.step(deep, 0) + 1, walker.stride(deep, 0), walker.hop(deep + 1, 0));
say(walkers.map(walker => [walker.step, walker.stride].map(method => method.call(walker, deep, 0))));
for (const walker of walkers) say(walker.step(0, 1), walker.stride(0, 1), walker.step(1, 1), walker.stride(1, 1));

class Namer {
  more: (this: Namer, n: number, acc: string) => string;
  marks: string[] = ["a", "b", "c"];
  constructor() { this.more = this.name; }
  name(n: number, acc: string): string {
    if (n === 0) return acc + "!";
    let extra = "";
    if (n % 100000 === 0) {
      for (let i = 0; i < this.marks.length; i++) extra += this.marks[i];
      for (const mark of this.marks) extra += mark.toUpperCase();
      for (let i = this.marks.length - 1; i >= 0; i--) extra += this.marks[i];
      for (const mark of this.marks) extra += mark.length;
    }
    return this.more(n - 1, acc + extra);
  }
}
const namer = new Namer();
say(namer.name(deep, ""), [namer.name].map(method => method.call(namer, deep + 1, "").length));

let threw = "";
try { (walkers[0].step as any).call({ hop() { throw new RangeError("the end"); } }, 5, 0); } catch (error) { threw = (error as Error).message; }
try { say(threw, (walkers[0].step as any).call({ hop: (n: unknown, acc: unknown) => n + "|" + acc, weights: [] }, "7", "x")); } catch (error) { say(threw, "texts for numbers:", (error as Error).constructor.name); }
console.log(lines.join("\n"));
