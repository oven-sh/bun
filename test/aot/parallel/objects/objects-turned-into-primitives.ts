// String(), template literals, +, keys and comparisons of objects: plain ones, instances with toString(), valueOf(), Symbol.toPrimitive and Symbol.toStringTag, own methods, methods that answer objects or throw, prototypes that change, dictionaries, objects without a prototype.
export {};
const lines: string[] = [];
let order = "";
const attempt = (read: () => unknown) => { order = ""; try { const value = read(); return typeof value + " " + String(value) + " " + order; } catch (error) { return (error as Error).constructor.name + " " + (error as Error).message + " " + order; } };
class Text { constructor(public x: number) {} toString() { order += "s"; return "T" + this.x; } }
class Value { constructor(public x: number) {} valueOf() { order += "v"; return this.x; } }
class Both { toString() { order += "s"; return "both"; } valueOf() { order += "v"; return 7; } }
class Tagged { get [Symbol.toStringTag]() { order += "t"; return "Tag"; } }
class TaggedPlain { x = 1; }
Object.defineProperty(TaggedPlain.prototype, Symbol.toStringTag, { value: "Plain" });
class Primitive { [Symbol.toPrimitive](hint: string) { order += hint; return hint === "number" ? 1 : "p-" + hint; } }
class Below extends Text { override toString() { return "below " + super.toString(); } }
class Silent extends Text {}
class AnswersObject { toString() { order += "s"; return {} as any; } }
class AnswersObjectTwice { toString() { order += "s"; return {} as any; } valueOf() { order += "v"; return [] as any; } }
class AnswersNumber { toString() { return 5 as any; } }
class AnswersSymbol { toString() { return Symbol("s") as any; } }
class AnswersBig { valueOf() { return 10n as any; } }
class AnswersNothing { toString() { return undefined as any; } valueOf() { return null as any; } }
class Throws { toString(): string { throw new RangeError("from toString"); } }
class ThrowsValue { valueOf(): number { throw new EvalError("from valueOf"); } }
class Own { toString = () => { order += "o"; return "own"; }; }
class Getter { get toString() { order += "g"; return () => "got"; } }
class NoMethod { x = 1; }
Object.defineProperty(NoMethod.prototype, "toString", { value: 5, configurable: true });
class Late { x = 1; }
const makers: Record<string, () => any> = {
  empty: () => ({}), one: () => ({ a: 1 }), nested: () => ({ a: { b: 2 } }), text: () => new Text(1), value: () => new Value(3), both: () => new Both(), tagged: () => new Tagged(), taggedPlain: () => new TaggedPlain(), ownTag: () => ({ [Symbol.toStringTag]: "Own" }), badTag: () => ({ [Symbol.toStringTag]: 5 }), primitive: () => new Primitive(), below: () => new Below(2), silent: () => new Silent(4),
  answersObject: () => new AnswersObject(), answersObjectTwice: () => new AnswersObjectTwice(), answersNumber: () => new AnswersNumber(), answersSymbol: () => new AnswersSymbol(), answersBig: () => new AnswersBig(), answersNothing: () => new AnswersNothing(), throws: () => new Throws(), throwsValue: () => new ThrowsValue(), own: () => new Own(), getter: () => new Getter(), noMethod: () => new NoMethod(), late: () => new Late(),
  literal: () => ({ toString() { order += "l"; return "literal"; } }), literalValue: () => ({ valueOf() { order += "w"; return 2; } }), bare: () => Object.create(null), bareText: () => Object.assign(Object.create(null), { toString: () => "bare" }), over: () => Object.create({ toString: () => "over" }), parsed: () => JSON.parse('{"a":1}'), frozen: () => Object.freeze({ a: 1 }), wide: () => { const o: any = {}; for (let k = 0; k < 100; k++) o["k" + k] = k; delete o.k3; return o; }, wideText: () => { const o: any = new Text(9); for (let k = 0; k < 100; k++) o["k" + k] = k; delete o.k3; o.toString = () => "wide"; return o; },
  proxy: () => new Proxy({}, {}), turned: () => Object.setPrototypeOf({}, Text.prototype), cut: () => Object.setPrototypeOf(new Text(5), null), map: () => new Map(), list: () => [1, 2], listOfObjects: () => [{}, new Text(6)], date: () => new Date(NaN), error: () => new Error("e"), fn: () => (() => "r"),
};
const uses: Record<string, (o: any) => unknown> = {
  string: o => String(o), template: o => `<${o}>`, before: o => "a" + o, after: o => o + "a", number: o => o + 1, twice: o => o + o, added: o => { let r: any = "x"; r += o; return r; }, minus: o => o - 1, less: o => o < 5, loose: o => o == "both", key: o => ({ "[object Object]": "plain", T1: "key" } as any)[o], joined: o => [o, o].join("-"), big: o => o + 1n, symbol: o => "a" + Symbol.for("x").toString() + o, concat: o => "a".concat(o), padded: o => "x".padStart(8, o), encoded: o => encodeURIComponent(o), index: o => "a[object Object]".indexOf(o), replace: o => "a".replace("a", o), parse: o => parseInt(o), unary: o => +o, list: o => String([o]), date: o => new Date(2020, 0) + o,
};
for (let turn = 0; turn < 3; turn++) {
  for (const [name, make] of Object.entries(makers)) {
    let text = name;
    const first = make(), second = make();
    for (const [use, act] of Object.entries(uses)) text += " | " + use + " " + attempt(() => act(first)) + (turn ? attempt(() => act(second)) : "");
    lines.push(text.replace(/\d{4} \d\d:\d\d:\d\d GMT[^)]*\)/g, "DATE"));
  }
}
function loops(objects: any[], turns: number) { let r = ""; for (let i = 0; i < turns; i++) { const o = objects[i % objects.length]; r += String(o) + `${o}` + ("+" + o) + (o + ";"); } return r; }
const changing = [new Late(), {}, new Text(1)];
for (let round = 0; round < 8; round++) {
  lines.push(loops(changing, 6));
  if (round === 1) (Late.prototype as any).toString = () => "late";
  if (round === 2) (changing[1] as any).toString = () => "own now";
  if (round === 3) (Late.prototype as any).valueOf = () => 11;
  if (round === 4) Object.defineProperty(Late.prototype, Symbol.toPrimitive, { value: (hint: string) => "hint " + hint, configurable: true });
  if (round === 5) { delete (Late.prototype as any)[Symbol.toPrimitive]; delete (Late.prototype as any).toString; (changing[2] as any)[Symbol.toStringTag] = "Changed"; }
  if (round === 6) { Object.setPrototypeOf(changing[2], null); delete (Late.prototype as any).valueOf; (Late.prototype as any)[Symbol.toStringTag] = "LateTag"; changing.pop(); }
}
for (const line of lines) console.log(line);
