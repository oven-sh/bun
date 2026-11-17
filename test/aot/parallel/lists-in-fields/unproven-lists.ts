// Loops over an array that a field holds and nothing proves: the field is read before the loop, and what it holds is checked there. Where the field holds something else, or is replaced while the loop runs, the loop does as it is written.
const lines: string[] = [];
function shown(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.map(shown).join(" ") + "]" : "object";
  return typeof value + ":" + String(value);
}

class Series {
  list: number[];
  constructor(list: number[]) {
    this.list = list;
  }
  increment(): void {
    for (let i = 0; i < this.list.length; i++) this.list[i] = (this.list[i]! + 1) % 1409;
  }
  halve(): void {
    for (let i = 0; i < this.list.length; i++) this.list[i] = this.list[i]! * 0.5;
  }
  reverse(): void {
    for (let i = 0, j = this.list.length - 1; i < j; i++, j--) {
      const kept = this.list[i]!;
      this.list[i] = this.list[j]!;
      this.list[j] = kept;
    }
  }
  bubble(): void {
    for (let i = 1; i < this.list.length; i++) {
      if (this.list[i]! < this.list[i - 1]!) {
        const kept = this.list[i]!;
        this.list[i] = this.list[i - 1]!;
        this.list[i - 1] = kept;
      }
    }
  }
  copy(): number[] {
    const copied: number[] = [];
    for (let i = 0; i < this.list.length; i++) copied[i] = this.list[i]!;
    return copied;
  }
  pushed(): number[] {
    const copied: number[] = [];
    for (let i = 0; i < this.list.length; i++) copied.push(this.list[i]! + 1);
    return copied;
  }
  odd(): number {
    let odd = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i]! & 1) odd++;
    return odd;
  }
  cut(): number {
    let sum = 0;
    for (let i = 0; i < this.list.length; i++) sum = (sum * 31 + this.list[i]!) | 0;
    return sum;
  }
  replaced(): number {
    let sum = 0;
    for (let i = 0; i < this.list.length; i++) {
      sum += this.list[i]!;
      if (i === 3) this.list = [1, 2.5, 3, 4, 5, 6];
    }
    return sum;
  }
  replacedByCall(): number {
    let sum = 0;
    for (let i = 0; i < this.list.length; i++) {
      this.list[i] = this.list[i]! + 1;
      if (i === 3) replace(this);
      sum += this.list.length;
    }
    return sum;
  }
  filledFromItself(): number[] {
    const filled: number[] = [];
    if (this.list.length & 1) this.list = filled;
    for (let i = 0; i < this.list.length && i < 30; i++) filled[i] = this.list[i]! + 1;
    return filled;
  }
}

let other: number[] = [9, 8, 7.5];
function replace(series: Series): void {
  const kept = series.list;
  series.list = other;
  other = kept;
}

const methods = ["increment", "halve", "reverse", "bubble", "copy", "pushed", "odd", "cut", "replaced", "replacedByCall", "filledFromItself"] as const;
const texts = ["[5,3,9,1,7,2,8]", "[5.5,3,9.25,1,7,2]", "[]", "[4]", '[1,"2",3,4]', "[1,null,3]", '{"length":3,"0":7,"1":8,"2":9}', '"abc"', "5", "null"];
for (const method of methods) {
  for (const text of texts) {
    const series = new Series(JSON.parse(text));
    let answer: unknown;
    try {
      for (let turn = 0; turn < 5; turn++) answer = series[method]();
    } catch (error) {
      answer = (error as Error).name;
    }
    lines.push(`${method} ${text} ${shown(answer)} ${shown(series.list)} ${shown(other)}`);
  }
  for (const change of ["hole", "nan", "frozen", "accessor", "getter"]) {
    const series = new Series(JSON.parse("[5,3,9,1,7,2,8]"));
    const list: any = series.list;
    let answer: unknown;
    try {
      answer = series[method]();
      if (change === "hole") delete list[3];
      if (change === "nan") list[3] = NaN;
      if (change === "frozen") Object.freeze(list);
      if (change === "accessor") {
        let kept = series.list;
        Object.defineProperty(series, "list", { get: () => kept, set: value => { kept = value; } });
      }
      if (change === "getter") Object.defineProperty(list, 2, { get: () => 77, set: () => { series.list = [1, 2]; } });
      for (let turn = 0; turn < 3; turn++) answer = series[method]();
    } catch (error) {
      answer = (error as Error).name;
    }
    lines.push(`${method} ${change} ${shown(answer)} ${shown(series.list)} ${shown(other)}`);
  }
}
for (const line of lines) console.log(line);
