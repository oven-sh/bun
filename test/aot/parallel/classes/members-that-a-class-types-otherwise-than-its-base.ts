// Where a class is defined, the members that it types otherwise than its base class are followed into the base's types: what is read through the base is what the class holds.
// Classes in a row, classes that extend one class, and classes of two bases by turns.
const out: string[] = [];
const say = (name: string, ...values: unknown[]) => out.push(name + ": " + values.map(value => JSON.stringify(value) ?? String(value)).join(" "));

class Shape { kind: string = "shape"; size: number | string = 0; tags: readonly unknown[] = []; describe(): string | number { return this.kind; } self(): this { return this; } }
class Circle extends Shape { override kind: "circle" = "circle"; override size: number = 2; override tags: string[] = ["round"]; override describe(): string { return this.kind + this.size; } }
class Dot extends Circle { override size: 1 = 1; override tags: ["tiny"] = ["tiny"]; override describe(): "dot" { return "dot"; } extra = true; }
const throughBase = (shape: Shape) => [shape.kind, shape.size, shape.tags, shape.describe(), shape.self() === shape, shape.self().kind];
say("row", throughBase(new Shape()), throughBase(new Circle()), throughBase(new Dot()));
const throughMiddle = (circle: Circle) => [circle.size + 1, circle.tags.join(), circle.describe().length, circle.self().size];
say("row from the middle", throughMiddle(new Circle()), throughMiddle(new Dot()));

class Left { value: unknown = null; read(): unknown { return this.value; } }
class Right { value: number | string | boolean = false; read(): number | string | boolean { return this.value; } }
class L1 extends Left { override value: number = 1; override read(): number { return this.value + 1; } }
class R1 extends Right { override value: string = "r1"; override read(): string { return this.value + "!"; } }
class L2 extends Left { override value: string[] = ["l2"]; override read(): string[] { return [...this.value, "read"]; } }
class R2 extends Right { override value: number = 22; override read(): number { return this.value * 2; } }
class L3 extends Left { override value: { deep: number } = { deep: 3 }; override read(): { deep: number } { return { deep: this.value.deep + 1 }; } }
class R3 extends Right { override value: true = true; override read(): true { return this.value; } }
const lefts: Left[] = [new Left(), new L1(), new L2(), new L3()];
const rights: Right[] = [new Right(), new R1(), new R2(), new R3()];
say("two bases by turns", lefts.map(left => [left.value, left.read()]), rights.map(right => [right.value, right.read()]));

class Box<T> { held: T; constructor(held: T) { this.held = held; } take(): T { return this.held; } map<U>(f: (held: T) => U): Box<U> { return new Box(f(this.held)); } }
class NumberBox extends Box<number> { override take(): number { return this.held + 1; } twice() { return this.held * 2; } }
class SmallBox extends NumberBox { override held: 1 | 2 = 1; constructor() { super(2); } override take(): 1 | 2 { return this.held; } }
const boxes: Box<number>[] = [new Box(5), new NumberBox(6), new SmallBox()];
say("a base with an argument", boxes.map(box => [box.held, box.take(), box.map(held => held + 0.5).held]));

class Gauge { #level = 1; get level(): number | string { return this.#level; } set level(value: number | string) { this.#level = Number(value); } get fixed(): unknown { return "gauge"; } peek() { return this.#level; } }
class Fine extends Gauge { #level = "fine"; override get level(): number { return 7; } override set level(value: number) { super.level = value * 2; } override get fixed(): string { return this.#level; } }
const gauges: Gauge[] = [new Gauge(), new Fine()];
say("accessors and private names", gauges.map(gauge => { gauge.level = 3; return [gauge.level, gauge.fixed, gauge.peek()]; }));

class Chain { next: Chain | null = null; depth(): number { return this.next ? this.next.depth() + 1 : 0; } link(next: this): this { this.next = next; return this; } }
class Named extends Chain { override next: Named | null = null; name = "n"; names(): string { return this.name + (this.next ? this.next.names() : ""); } }
const chain: Chain = new Named().link(new Named().link(new Named()));
say("a member of the class's own type", chain.depth(), (chain as Named).names(), chain.next instanceof Named);

class Optional { maybe?: number | string; also?: unknown[]; }
class Present extends Optional { override maybe: number = 4; override also: number[] = [4]; }
const optionals: Optional[] = [new Optional(), new Present()];
say("an optional member that the class always has", optionals.map(each => [each.maybe, each.also, "maybe" in each]));

console.log(out.join("\n"));
