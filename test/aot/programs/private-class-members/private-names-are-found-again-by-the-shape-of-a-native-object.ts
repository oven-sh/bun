// An instance of a class with a built-in parent, and an object that a constructor returned, keep a private name as a property. The run time remembers where the name lies for the
// shapes it has met. What it remembers says nothing about which evaluation of the class an object belongs to, about an object of another shape, or about a name that is defined twice.
const lines: string[] = [];
function attempt(label: string, run: () => unknown): void {
  try { lines.push(label + ": " + String(run())); } catch (error) { lines.push(label + ": threw " + (error as Error).constructor.name); }
}

class Failure extends Error {
  #code: number;
  #notes: string[] = [];
  extra = 1;
  constructor(code: number) { super("failure " + code); this.#code = code; }
  code(): number { return this.#code; }
  bump(): number { this.#code += 1; return this.#code; }
  note(text: string): number { this.#notes.push(text); return this.#notes.length; }
  static codeOf(value: unknown): number { return (value as Failure).#code; }
  static has(value: object): boolean { return #code in value; }
}
class Deeper extends Failure { more = 2; #own = "deep"; own(): string { return this.#own + this.code(); } }
class Table extends Map<string, number> { #reads = 0; read(key: string): number { this.#reads++; return (this.get(key) ?? -1) + this.#reads; } }
class List extends Array<number> { #sum = 0; add(value: number): number { this.push(value); this.#sum += value; return this.#sum; } }

const failures = [new Failure(1), new Failure(2), new Deeper(3)];
for (let round = 0; round < 4; ++round) {
  for (const failure of failures) attempt("round " + round, () => failure.code() + "," + failure.bump() + "," + failure.note("n" + round) + "," + Failure.codeOf(failure));
}
attempt("deeper", () => (failures[2] as Deeper).own());
const table = new Table([["a", 10]]), list = new List();
for (let round = 0; round < 4; ++round) attempt("table and list " + round, () => table.read("a") + "," + table.read("b") + "," + list.add(round + 1) + "," + list.length);

// The same shape, another evaluation of the class.
function makeClass() {
  return class Stamped extends Error {
    #mark: number;
    constructor(mark: number) { super("stamped"); this.#mark = mark; }
    static read(value: unknown): number { return (value as Stamped).#mark; }
    static write(value: unknown, mark: number): number { return (value as Stamped).#mark = mark; }
  };
}
const First = makeClass(), Second = makeClass();
const first = new First(10), second = new Second(20);
for (let round = 0; round < 3; ++round) {
  attempt("first by First", () => First.read(first));
  attempt("second by Second", () => Second.read(second));
  attempt("second by First", () => First.read(second));
  attempt("first by Second", () => Second.read(first));
  attempt("store second by First", () => First.write(second, 1));
  attempt("store first by First", () => First.write(first, 11 + round));
}

// Objects of many shapes get the name from a constructor that returns them.
class Returns { constructor(value: object) { return value; } }
class Stamp extends Returns {
  #seal = 7;
  constructor(value: object) { super(value); }
  static seal(value: object): number { return (value as Stamp).#seal; }
  static reseal(value: object, seal: number): void { (value as Stamp).#seal = seal; }
}
const shapes: object[] = [{}, { a: 1 }, { b: 1 }, { a: 1, b: 2 }, [1, 2], new Map(), new Error("e"), () => 1, new Date(0), { c: 1, d: 2, e: 3 }];
for (const shape of shapes) new Stamp(shape);
for (let round = 0; round < 3; ++round) attempt("seals " + round, () => shapes.map((shape, index) => { Stamp.reseal(shape, Stamp.seal(shape) + index); return Stamp.seal(shape); }).join());
attempt("no seal", () => Stamp.seal({ a: 1 }));
attempt("sealed twice", () => new Stamp(shapes[1]));

// The shape changes under the name.
const changing = new Failure(40) as Failure & Record<string, unknown>;
attempt("before", () => changing.code());
changing.added = 1;
attempt("a name more", () => changing.bump());
delete (changing as Record<string, unknown>).extra;
attempt("a name less", () => changing.bump());
for (let index = 0; index < 80; ++index) changing["k" + index] = index;
for (let index = 0; index < 80; index += 2) delete changing["k" + index];
attempt("many names come and gone", () => changing.bump() + "," + Failure.has(changing));
Object.freeze(changing);
attempt("frozen", () => changing.bump() + "," + changing.note("frozen"));
Object.setPrototypeOf(failures[0], null);
attempt("no prototype", () => Failure.codeOf(failures[0]) + "," + Failure.has(failures[0]));
attempt("a primitive", () => Failure.codeOf(5));
attempt("nothing", () => Failure.codeOf(undefined));
console.log(lines.join("\n"));
