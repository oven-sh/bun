// Private names whose slots hold every kind of value, read from receivers of unknown type: instances, instances of a subclass, unfinished instances, objects that lack the name, and a class that is evaluated twice.
class Kinds {
  #whole = 7;
  #negative = -3;
  #fraction = 0.5;
  #huge = 2 ** 40;
  #notANumber = NaN;
  #minusZero = -0;
  #flag = true;
  #maybeFlag: boolean | undefined = undefined;
  #text = "text";
  #built: string;
  #maybeText: string | null = null;
  #maybeNumber: number | undefined = undefined;
  #maybeWhole: number | null = 5;
  #object: { tag: string } = { tag: "object" };
  #maybeObject: { tag: string } | null = null;
  #list = [1, 2, 3];
  #big = 12345678901234567890n;
  #symbol = Symbol.for("kinds");
  #arrow = () => "arrow " + this.#whole;
  #anything: unknown = "anything";
  #byte = 200;
  constructor(seed: number) {
    this.#built = "built " + seed;
    this.#byte = seed & 255;
  }
  static read(object: any): unknown[] {
    return [
      object.#whole, object.#negative, object.#fraction, object.#huge, object.#notANumber, Object.is(object.#minusZero, -0), object.#flag, object.#maybeFlag,
      object.#text, object.#built, object.#maybeText, object.#maybeNumber, object.#maybeWhole, object.#object.tag, object.#maybeObject, object.#list.join("+"),
      object.#big, object.#symbol.description, object.#arrow(), object.#anything, object.#byte,
    ];
  }
  static change(object: any, round: number): void {
    object.#whole = round;
    object.#negative = -round;
    object.#fraction = round + 0.25;
    object.#huge = 2 ** 40 + round;
    object.#flag = round % 2 === 0;
    object.#maybeFlag = round % 3 === 0 ? undefined : round % 3 === 1;
    object.#text = round % 2 ? "odd" : "even";
    object.#built = "round " + round;
    object.#maybeText = round % 2 ? null : "some " + round;
    object.#maybeNumber = round % 2 ? round / 2 : undefined;
    object.#maybeWhole = round % 2 ? null : round;
    object.#object = { tag: "tag " + round };
    object.#maybeObject = round % 2 ? { tag: "maybe " + round } : null;
    object.#list = [round, round + 1];
    object.#big = BigInt(round) * 1000000000000n;
    object.#anything = round % 3 === 0 ? round : round % 3 === 1 ? "text " + round : { round };
    object.#byte = round & 255;
  }
}

class Child extends Kinds {
  #own = "own";
  extra = 1;
  static own(object: any): string {
    return object.#own;
  }
}

const show = (values: unknown[]) => values.map(value => (typeof value === "bigint" ? value + "n" : typeof value === "object" ? JSON.stringify(value) : String(value))).join(" ");
const kinds = new Kinds(300);
const child = new Child(7);
console.log(show(Kinds.read(kinds)));
console.log(show(Kinds.read(child)), Child.own(child));
for (let round = 1; round <= 6; round++) {
  Kinds.change(kinds, round);
  Kinds.change(child, round + 10);
  console.log(show(Kinds.read(kinds)));
  console.log(show(Kinds.read(child)));
}

// Often enough for whatever is remembered.
let length = 0;
for (let round = 0; round < 3000; round++) {
  Kinds.change(round % 2 ? kinds : child, round);
  length += show(Kinds.read(round % 3 ? kinds : child)).length;
}
console.log(length);

for (const object of [{}, [], null, undefined, 1, "text", new Map(), Object.create(kinds), Kinds, Kinds.prototype, new Proxy(kinds, {})]) {
  try {
    console.log(show(Kinds.read(object)));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
try {
  console.log(Child.own(kinds));
} catch (error) {
  console.log((error as Error).constructor.name);
}

// A name that is read before its initializer has run.
class Unfinished {
  #first = Unfinished.peek(this);
  #second = 2;
  static peek(object: any): string {
    try {
      return "second is " + object.#second;
    } catch (error) {
      return "second throws " + (error as Error).constructor.name;
    }
  }
  static first(object: any): string {
    return object.#first + ", then " + Unfinished.peek(object);
  }
}
console.log(Unfinished.first(new Unfinished()));

// Each evaluation of a class has names of its own.
function declare(tag: string) {
  return class Tagged {
    #tag = tag;
    #count = tag.length;
    static read(object: any): string {
      return object.#tag + " " + object.#count;
    }
  };
}
const First = declare("first");
const Second = declare("the second");
for (const [name, read, object] of [["first", First.read, new First()], ["second", Second.read, new Second()], ["first of second", First.read, new Second()], ["second of first", Second.read, new First()]] as [string, (object: unknown) => string, object][]) {
  try {
    console.log(name, read(object));
  } catch (error) {
    console.log(name, (error as Error).constructor.name);
  }
}

// Stored by typed code alone, so each slot is as narrow as its type allows, and read from receivers of unknown type.
class Narrow {
  #whole: number;
  #fraction: number;
  #flag: boolean;
  #text: string;
  #object: { tag: string };
  #maybeObject: { tag: string } | null;
  #next: Narrow | null = null;
  #byte: number;
  #arrow = () => this.#whole * 2;
  constructor(seed: number) {
    this.#whole = seed | 0;
    this.#fraction = seed + 0.5;
    this.#flag = seed % 2 === 0;
    this.#text = seed % 2 ? "odd" : "even";
    this.#object = { tag: "tag " + seed };
    this.#maybeObject = seed % 3 ? { tag: "maybe " + seed } : null;
    this.#byte = seed & 255;
  }
  step(next: Narrow): void {
    this.#whole = (this.#whole + 1) | 0;
    this.#fraction = this.#fraction * 1.5;
    this.#flag = !this.#flag;
    this.#text = this.#flag ? "set" : "clear";
    this.#next = next;
    this.#byte = (this.#byte + 7) & 255;
  }
  static read(object: any): unknown[] {
    return [object.#whole, object.#fraction, object.#flag, object.#text, object.#object.tag, object.#maybeObject, object.#next === null ? "end" : object.#next.#whole, object.#byte, object.#arrow()];
  }
}
const narrow = [new Narrow(1), new Narrow(2), new Narrow(3)];
for (let round = 0; round < 4; round++) {
  for (const one of narrow) console.log(show(Narrow.read(one)));
  narrow.forEach((one, index) => one.step(narrow[(index + 1) % 3]));
}
try {
  console.log(show(Narrow.read(kinds)));
} catch (error) {
  console.log((error as Error).constructor.name);
}
