// A constructor stores into an object that nobody else has seen yet, so the compiler knows what the object holds. These constructors get arguments of other types than declared,
// hand `this` out between two stores, freeze it, delete from it, add to it by name or run other code half way: the keys, their order and the values have to come out as written.
function given<T>(text: string): T { return JSON.parse(text) as T; }
function show(object: object): string { return JSON.stringify(object, (_, value) => value === undefined ? "undefined" : typeof value === "bigint" ? value + "n" : value) + " " + Object.keys(object).join() + " " + Object.isFrozen(object); }
const seen: object[] = [];

function Plain(this: any, kind: number, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; this.flags = 0; this.parent = undefined; this.original = undefined; }
function Handed(this: any, a: number, b: string) { this.a = a; seen.push(this); this.b = b; this.c = undefined; }
function Frozen(this: any, a: number, b: string) { this.a = a; Object.freeze(this); try { this.b = b; } catch (error) { seen.push({ error: (error as Error).constructor.name }); } }
function Deleting(this: any, a: number, b: string) { this.a = a; this.b = b; delete this.a; this.c = a; this.a = b; }
function ByName(this: any, a: number, name: string) { this.a = a; this[name] = 1; this.b = 2; this.c = undefined; }
function Calling(this: any, a: number, disturb: (object: any) => void) { this.a = a; disturb(this); this.b = a + 1; this.c = undefined; }
function Twice(this: any, a: number) { this.a = a; this.b = undefined; this.a = a + 1; this.b = a + 2; this.c = this.a + this.b; }
function Branching(this: any, a: number, first: boolean) { if (first) { this.x = a; this.y = undefined; } else { this.y = a; this.x = undefined; } this.z = 0; }
function Looping(this: any, count: number) { this.n = count; for (let i = 0; i < count; i++) this.n += i; this.m = undefined; this.k = count; }
function Returning(this: any, a: number, other: object | undefined) { this.a = a; if (other) return other; this.b = undefined; }
class Base { a: number; b?: string; constructor(a: number) { this.a = a; this.b = undefined; } }
class Derived extends Base { c: number; d?: object; constructor(a: number, c: number) { super(a); this.c = c; this.d = undefined; } }
class WithInitializers { a = 1; b: string | undefined = undefined; c = [1]; d?: number; constructor(d: number | undefined) { this.d = d; } }

type Anything = new (...values: any[]) => object;
const make = (maker: unknown, ...values: unknown[]) => { try { return show(new (maker as Anything)(...values)); } catch (error) { return (error as Error).constructor.name; } };
for (let round = 0; round < 3; round++) {
  console.log(make(Plain, 1, 2, 3), make(Plain, 1.5, 2, 3), make(Plain, 1, "two", 3), make(Plain, 1, 2, undefined), make(Plain, 2 ** 31, -(2 ** 31), 2 ** 53), make(Plain, null, {}, 4n), make(Plain));
  console.log(make(Handed, 1, "b"), make(Handed, "a", 2), seen.map(show).join(" | ")); seen.length = 0;
  console.log(make(Frozen, 1, "b"), seen.map(show).join(" | ")); seen.length = 0;
  console.log(make(Deleting, 1, "b"), make(Deleting, "x", 2));
  console.log(make(ByName, 1, "z"), make(ByName, 1, "b"), make(ByName, 1, "a"), make(ByName, 1, "c"), make(ByName, 1, "0"));
  console.log(make(Calling, 1, () => {}), make(Calling, 1, (o: any) => { o.b = "early"; }), make(Calling, 1, (o: any) => { o.z = 1; }), make(Calling, 1, (o: any) => { delete o.a; }), make(Calling, 1, (o: any) => { Object.preventExtensions(o); }));
  console.log(make(Twice, 1), make(Twice, "s"), make(Branching, 1, true), make(Branching, 1, false), make(Branching, "s", given<boolean>("true")));
  console.log(make(Looping, 0), make(Looping, 4), make(Returning, 1, undefined), make(Returning, 1, { other: true }), make(Returning, 1, given<object>("[1]")));
  console.log(make(Base, 1), make(Derived, 1, 2), make(Derived, "a", "c"), make(WithInitializers, 4), make(WithInitializers, undefined));
}

// Many, so that the code in question is the code that runs, with the odd one among them.
let text = "";
for (let i = 0; i < 4000; i++) {
  const node = new (Plain as unknown as Anything)(i % 7, i, i % 1000 === 999 ? "end" : i + 1) as Record<string, unknown>;
  if (i % 500 === 499) text += Object.keys(node).join("") + node.end + ";";
}
console.log(text);
