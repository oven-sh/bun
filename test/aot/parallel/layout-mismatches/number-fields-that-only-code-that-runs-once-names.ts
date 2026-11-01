// Every function here runs once, outside every loop, so none of this code gets a test of a type. The fields are declared numbers and get whatever JSON.parse answers.
function outside(text: string): any { return JSON.parse(text); }
function show(label: string, value: unknown) { console.log(label, typeof value, JSON.stringify(value), Object.is(value, -0) ? "minus zero" : ""); }

function makeNumber(n: number) { return { a: n, b: 2 }; }
const number = makeNumber(outside("7"));
show("number", number.a);
console.log(number.a + number.b, Object.keys(number).join(), JSON.stringify(number));

function makeFraction(n: number) { return { c: n, d: 2 }; }
const fraction = makeFraction(outside("3.5"));
show("fraction", fraction.c);
console.log(fraction.c * 2);

function makeMinusZero(n: number) { return { e: n }; }
show("minus zero", makeMinusZero(outside("-0")).e);

function makeText(n: number) { return { f: n, g: 2 }; }
const text = makeText(outside('"seven"'));
show("text", text.f);
console.log(text.f + text.g, Object.keys(text).join(), JSON.stringify(text));

function makeNull(n: number) { return { h: n, i: 2 }; }
const nothing = makeNull(outside("null"));
show("null", nothing.h);
console.log(nothing.h + nothing.i, "h" in nothing, Object.hasOwn(nothing, "h"));

function makeMissing(n: number) { return { j: n, k: 2 }; }
const missing = makeMissing(outside("{}").nowhere);
show("undefined", missing.j);
console.log(Object.keys(missing).join(), "j" in missing, JSON.stringify(missing));

function makeObject(n: number) { return { l: n, m: 2 }; }
const object = makeObject(outside('{"inner":[1,2,3]}'));
show("object", object.l);
Bun.gc(true);
show("object behind a collection", object.l);

// A function where a number was declared.
function makeFunction(n: number) { return { o: n }; }
const callable: any = makeFunction((() => "called") as any);
console.log(typeof callable.o, callable.o());

// Stored again, with a number and with something else.
function makeStored(n: number) { return { p: n, q: 2 }; }
const stored = makeStored(outside("1"));
stored.p = outside("2.25");
show("stored a fraction", stored.p);
stored.p = outside('"text"');
show("stored a text", stored.p);
stored.p = 4;
show("stored an integer", stored.p);

// Deleted, defined again, frozen.
function makeDeleted(n: number) { return { r: n, s: 2 }; }
const deleted: any = makeDeleted(outside("5"));
delete deleted.r;
show("deleted", deleted.r);
console.log(Object.keys(deleted).join());
deleted.r = outside("6");
console.log(Object.keys(deleted).join(), deleted.r);

function makeRedefined(n: number) { return { t: n, u: 2 }; }
const redefined = makeRedefined(outside("5"));
Object.defineProperty(redefined, "t", { get() { return "a getter"; }, enumerable: true, configurable: true });
show("redefined", redefined.t);

function makeFrozen(n: number) { return Object.freeze({ v: n, w: 2 }); }
const frozen = makeFrozen(outside('"frozen"'));
try { (frozen as any).v = 1; } catch (error) { console.log((error as Error).constructor.name); }
show("frozen", frozen.v);

// A field of a class, one that a class below inherits, and one that the constructor leaves out.
class Holder { value: number; constructor(value: number) { this.value = value; } }
class Heir extends Holder { other: number; constructor(value: number, other: number) { super(value); this.other = other; } }
const holder = new Holder(outside('"held"'));
show("class", holder.value);
const heir = new Heir(outside("[1]"), outside("true"));
show("inherited", heir.value);
show("own", heir.other);
console.log(Object.keys(heir).join(), JSON.stringify(heir));

class Late { size!: number; }
const late = new Late();
show("left out", late.size);
late.size = outside('"late"');
show("filled late", late.size);

// Copied, spread and destructured.
function makeCopied(n: number) { return { x: n, y: 2 }; }
const copied = makeCopied(outside('"copied"'));
const { x, ...rest } = copied;
show("destructured", x);
console.log(JSON.stringify({ ...copied, z: 3 }), JSON.stringify(rest), JSON.stringify(Object.assign({}, copied)), JSON.stringify(Object.entries(copied)), JSON.stringify(structuredClone(copied)));
