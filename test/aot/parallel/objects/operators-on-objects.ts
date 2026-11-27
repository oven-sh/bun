// Operators on objects: which of valueOf(), toString() and Symbol.toPrimitive run, in which order, with which hint, and what is thrown before the other operand is asked.
export {};
const lines: string[] = [];
let order = "";
const attempt = (read: () => unknown) => { order = ""; try { const value = read(); return typeof value + ":" + String(value) + (Object.is(value, -0) ? "-" : "") + " " + order; } catch (error) { return (error as Error).constructor.name + " " + order; } };
class Money { constructor(public cents: number) {} valueOf() { order += "m" + this.cents; return this.cents; } }
class Labelled { constructor(public label: string) {} toString() { order += "l" + this.label; return this.label; } }
class Both { valueOf() { order += "v"; return 3; } toString() { order += "s"; return "both"; } }
class Exotic { [Symbol.toPrimitive](hint: string) { order += "x" + hint; return hint === "string" ? "text" : 4; } }
class ExoticObject { [Symbol.toPrimitive]() { order += "xo"; return {} as any; } }
class ExoticSymbol { [Symbol.toPrimitive]() { order += "xs"; return Symbol("s") as any; } }
class Big { valueOf() { order += "b"; return 5n as any; } }
class Symbolic { valueOf() { order += "y"; return Symbol("v") as any; } }
class ObjectsAlone { valueOf() { order += "o"; return {} as any; } toString() { order += "t"; return [] as any; } }
class FallsThrough { valueOf() { order += "f"; return {} as any; } toString() { order += "g"; return "8"; } }
class Throws { valueOf(): number { order += "!"; throw new RangeError("v"); } }
class Text { valueOf() { order += "q"; return "12" as any; } }
class Nothing { valueOf() { order += "n"; return undefined as any; } }
class Nullish { valueOf() { order += "z"; return null as any; } }
class True { valueOf() { order += "u"; return true as any; } }
class Below extends Money { override valueOf() { order += "w"; return super.valueOf() * 10; } }
class Getter { get valueOf() { order += "G"; return () => 6; } }
class OwnValue { valueOf = () => { order += "O"; return 7; }; }
class UndefinedExotic { valueOf() { order += "e"; return 9; } }
Object.defineProperty(UndefinedExotic.prototype, Symbol.toPrimitive, { value: undefined, configurable: true });
class NullExotic { valueOf() { order += "h"; return 9; } }
Object.defineProperty(NullExotic.prototype, Symbol.toPrimitive, { value: null, configurable: true });
class BadExotic { valueOf() { return 9; } }
Object.defineProperty(BadExotic.prototype, Symbol.toPrimitive, { value: 5, configurable: true });
const values: Record<string, any> = {
  money: new Money(150), other: new Money(7), labelled: new Labelled("21"), word: new Labelled("word"), both: new Both(), exotic: new Exotic(), exoticObject: new ExoticObject(), exoticSymbol: new ExoticSymbol(), big: new Big(), symbolic: new Symbolic(), objects: new ObjectsAlone(), falls: new FallsThrough(), throws: new Throws(), text: new Text(), nothing: new Nothing(), nullish: new Nullish(), yes: new True(), below: new Below(2), getter: new Getter(), own: new OwnValue(), undefinedExotic: new UndefinedExotic(), nullExotic: new NullExotic(), badExotic: new BadExotic(),
  plain: { a: 1 }, literal: { valueOf() { order += "L"; return 11; } }, bare: Object.create(null), list: [2], date: new Date(5), map: new Map(), number: 3, zero: -0, string: "3", letters: "abc", yesValue: true, none: null, missing: undefined, bigint: 5n, symbol: Symbol("p"), proxy: new Proxy(new Money(2), {}), fn: () => 1,
};
const binary: Record<string, (a: any, b: any) => unknown> = {
  plus: (a, b) => a + b, minus: (a, b) => a - b, times: (a, b) => a * b, over: (a, b) => a / b, mod: (a, b) => a % b, power: (a, b) => a ** b, and: (a, b) => a & b, or: (a, b) => a | b, xor: (a, b) => a ^ b, left: (a, b) => a << b, right: (a, b) => a >> b, unsigned: (a, b) => a >>> b, less: (a, b) => a < b, lessEqual: (a, b) => a <= b, greater: (a, b) => a > b, greaterEqual: (a, b) => a >= b, loose: (a, b) => a == b, different: (a, b) => a != b,
};
const unary: Record<string, (a: any) => unknown> = { plus: a => +a, minus: a => -a, not: a => ~a, no: a => !a, number: a => Number(a), next: a => { let x = a; x++; return x; }, before: a => { let x = a; return --x; }, max: a => Math.max(a, 1), absolute: a => Math.abs(a), nan: a => isNaN(a), float: a => parseFloat(a), big: a => BigInt(a), fixed: a => (5.5).toFixed(a), index: a => [1, 2, 3].at(a), repeat: a => "ab".repeat(a) };
for (let turn = 0; turn < 2; turn++) {
  for (const [name, a] of Object.entries(values)) {
    let text = name;
    for (const [operator, act] of Object.entries(unary)) text += " | " + operator + " " + attempt(() => act(a));
    lines.push(text);
    for (const [otherName, b] of Object.entries(values)) {
      text = name + " " + otherName;
      for (const [operator, act] of Object.entries(binary)) { if (typeof a === "function" || typeof b === "function") continue; text += " | " + operator + " " + attempt(() => act(a, b)); }
      lines.push(text.replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} [^|]*?\)/g, "DATE"));
    }
  }
}
function total(items: any[], turns: number) { let sum: any = 0, least: any = items[0], text: any = ""; for (let i = 0; i < turns; i++) { const item = items[i % items.length]; sum += item * 2 - 1; if (item < least) least = item; if (item == 7) text += "seven"; sum = sum + +item; } return String(sum) + " " + Number(least) + text; }
const changing = [new Money(3), new Money(7), new Money(5)];
for (let round = 0; round < 6; round++) {
  lines.push(total(changing, 7));
  if (round === 0) (Money.prototype as any).valueOf = function (this: Money) { return this.cents + 1; };
  if (round === 1) Object.defineProperty(Money.prototype, Symbol.toPrimitive, { value: (hint: string) => hint.length, configurable: true });
  if (round === 2) delete (Money.prototype as any)[Symbol.toPrimitive];
  if (round === 3) delete (Money.prototype as any).valueOf;
  if (round === 4) (changing[1] as any).valueOf = () => 100;
}
for (const line of lines) console.log(line);
