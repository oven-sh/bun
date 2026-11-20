// For each element a small function is called that keeps its `arguments` in a note: as the tag of a template, with more arguments than it declares, with as many, and with fewer.
// Sizes: 1000 4000 16000
// Passes: 60
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
class Note {
  constructor(readonly held: IArguments) {}
  get weight(): number {
    let sum = this.held.length;
    for (let i = 0; i < this.held.length; i++) if (typeof this.held[i] === "number") sum += this.held[i];
    return sum;
  }
}
function tag(strings: TemplateStringsArray, ...values: unknown[]): Note {
  return new Note(arguments);
}
function one(a: number, ..._: unknown[]): Note {
  return new Note(arguments);
}
function three(a?: number, b?: number, c?: number): Note {
  return new Note(arguments);
}
function once(): string {
  let sum = 0;
  let last: Note | undefined;
  for (let i = 0; i < size; i++) {
    const x = i & 7;
    last = tag`read(${x}, ${i & 3})`;
    sum = (sum + last.weight) | 0;
    last = one(x, 1, 2, 3);
    sum = (sum + last.weight) | 0;
    last = three(x, 1, 2);
    sum = (sum + last.weight) | 0;
    last = three(x);
    sum = (sum + last.weight) | 0;
  }
  return [sum, last!.held.length].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
