// A program that evaluates text may reach every object. A private field of a written type is stored undefined or null again and again.
const never: any = JSON.parse("0");
const kept: any[] = [];
if (never) eval("");

class Third {
  #value: number;
  constructor(seed: number) {
    if (never) kept.push(this);
    this.#value = seed / 3;
  }
  static clear(turns: number): unknown[] {
    const third = new Third(turns);
    const seen: unknown[] = [];
    for (let k = 0; k < turns; k++) {
      third.#value = (k & 1 ? 0 : null) as any;
      seen.push(third.#value);
    }
    return seen;
  }
  static swap(turns: number, third: Third): string {
    let nothing = 0;
    for (let k = 0; k < turns; k++) {
      if ((third.#value as unknown) === null) nothing++;
      third.#value = (k & 1 ? 0.5 : null) as any;
    }
    return nothing + " " + third.#value;
  }
}
console.log(Third.clear(1), Third.clear(4), Third.clear(7));
const third = new Third(6);
console.log(Third.swap(1, third), Third.swap(5, third), Third.swap("6" as any, third), Third.swap(300, third));

class Text {
  #text: string;
  #parts: { count: number };
  constructor(seed: number) {
    if (never) kept.push(this);
    this.#text = "t" + seed;
    this.#parts = { count: seed };
  }
  run(turns: number): string {
    for (let k = 0; k < turns; k++) {
      this.#text = (k & 1 ? "u" + k : null) as any;
      this.#parts = (k % 3 ? { count: k } : null) as any;
    }
    return this.#text + " " + (this.#parts as { count: number } | null)?.count;
  }
}
const text = new Text(1);
console.log(text.run(0), text.run(1), text.run(4), text.run("5" as any), text.run(301));

// The same under a public name.
class Open {
  value: number;
  constructor(seed: number) {
    if (never) kept.push(this);
    this.value = seed / 3;
  }
}
function clear(open: Open, turns: number): string {
  for (let k = 0; k < turns; k++) open.value = (k & 1 ? 0 : null) as any;
  return open.value + " " + Object.keys(open) + " " + JSON.stringify({ ...open });
}
const open = new Open(6);
console.log(clear(open, 0), clear(open, 1), clear(open, 4), clear(open, "5" as any));
