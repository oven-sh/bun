// What is known about one object because of where it was made (it is the only one of its kind, it is a constant, it never leaves its function, another object lies inside it)
// says nothing about a copy of it: the copy is another object, with the same values, and what is stored in one is not seen in the other.
const lines: string[] = [];
function say(title: string, ...parts: unknown[]) {
    lines.push(title + ": " + parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}
function withId<T extends object>(source: T, id: number) {
    return { ...source, id };
}
function alone<T extends object>(source: T) {
    return { ...source };
}
function ofAnything(source: any, id: number) {
    return { ...source, id };
}

// A constant written once at the top of the module.
const defaults = { id: 0, label: "d", ratio: 2.5, on: true };
for (let round = 0; round < 3; round++) {
    const copy = withId(defaults, round + 1);
    copy.label = "changed " + round;
    copy.ratio += 1;
    say("a constant", copy, defaults, copy === (defaults as object));
}
const second = alone(defaults);
second.on = false;
defaults.label = "the source changed";
say("a constant, afterwards", second, defaults);

// The only object of its kind, with values that are known when it is made.
const only = { id: lines.length, made: String(lines.length), list: [lines.length], inner: { deep: lines.length } };
const ofOnly = withId(only, -1);
ofOnly.made = "copy";
ofOnly.list.push(1);
ofOnly.inner.deep++;
say("the only one", ofOnly, only, ofOnly.list === only.list, ofOnly.inner === only.inner);
ofOnly.inner = { deep: 100 };
ofOnly.list = [];
say("the only one, other members", ofOnly, only);

// Objects and lists written inside a literal.
type Point = { x: number; y: number };
type Shape = { at: Point; size: Point; tags: string[]; weights: number[]; name: string };
function shape(n: number): Shape {
    return { at: { x: n, y: n + 1 }, size: { x: 2 * n, y: 3 * n }, tags: ["a" + n, "b"], weights: [n, n + 0.5], name: "s" + n };
}
function measure(s: Shape): number {
    return s.at.x + s.at.y * 10 + s.size.x * 100 + s.size.y * 1000 + s.tags.length + s.tags[0]!.length + s.weights[1]! + s.name.length;
}
let sum = 0;
const keptShapes: (Shape & { id: number })[] = [];
for (let round = 0; round < 3000; round++) {
    const source = shape(round & 7);
    const copy = withId(source, round);
    sum += measure(copy) + measure(source);
    if (copy.at !== source.at || copy.tags !== source.tags || copy.weights !== source.weights)
        sum += 1e9;
    copy.at.x++;
    sum += source.at.x;
    copy.size = { x: 1, y: 1 };
    sum += measure(copy) - measure(source);
    if ((round & 255) === 0)
        keptShapes.push(copy);
}
say("objects inside", sum, keptShapes.length, keptShapes[3], measure(keptShapes[5]!));
say("objects inside, of anything", ofAnything(shape(2), 9), measure(ofAnything(shape(3), 1)), measure(alone(shape(4))));
function row(props: { cells: string[]; at: Point }) {
    return props.cells.map((cell) => cell + props.at.x).join();
}
const call = (target: any, props: any, ...children: any[]) => target({ ...props, children });
say("as a component gets them", call(row, { cells: ["a", "b"], at: { x: 1, y: 2 } }), call(row, { cells: [], at: { x: 3, y: 4 } }, 1, 2));

// One literal, one call, one reader with a declared type.
const render = (tag: any, props: any, ...children: any[]): any => (typeof tag === "function" ? tag({ ...props, children }) : tag + "(" + children.join() + ")");
const cell = function (props: { children?: any }) {
    return render("cell", null, props.children);
};
const cellsOf = (props: { cells: string[] }) => render("row", null, props.cells.map((one) => render(cell, null, one)));
say("one literal with a list", render(cellsOf, { cells: ["a", "b"] }));
const placeOf = (props: { place: { x: number; y: number }; name: string }) => props.name + props.place.x + props.place.y;
say("one literal with an object", render(placeOf, { place: { x: 1.5, y: 2 }, name: "p" }));
type Reply<T> = { ok: true; data: T; reply: { body: T; code: number } } | { ok: false; reason: string };
type Routed<T> = Reply<T> & { route: "direct" | "far" };
function reply<T>(data: T): Reply<T> {
    return data === null ? { ok: false, reason: "null" } : { ok: true, data, reply: { body: data, code: 2 } };
}
function routed<T>(data: T): Routed<T> {
    return { ...reply(data), route: "direct" };
}
function codeOf(result: Routed<unknown>) {
    return result.ok ? result.route + result.reply.code + JSON.stringify(result.reply.body) : result.reason;
}
say("a member of a union with an object inside", codeOf(routed(1)), codeOf(routed("s")), codeOf(routed(null)), codeOf(routed({ k: 1 })));

// A source that never leaves its function; the copy does, and lives on.
function leaves(n: number) {
    const local = { a: n, b: n + 0.5, c: "c" + n, d: { e: n } };
    return withId(local, n);
}
const left: ReturnType<typeof leaves>[] = [];
for (let round = 0; round < 20000; round++) {
    const made = leaves(round);
    if ((round & 1023) === 0)
        left.push(made);
}
say("the source stayed", left.length, left[0], left[19], left.reduce((total, one) => total + one.a + one.b + one.c.length + one.d.e + one.id, 0));
say("a literal in the spread", withId({ a: 1, b: [2], c: { d: 3 } }, 4), alone({ ...{ a: 1 }, b: { c: 2 } }));

// Functions written in the literal.
function counter(start: number) {
    return { n: start, next() { return ++this.n; }, peek: () => start, twice(this: { n: number }) { return this.n * 2; } };
}
const first = counter(5);
const copied = withId(first, 1);
say("functions", copied.next(), copied.next(), first.n, first.next(), copied.n, copied.peek(), copied.twice(), copied.next === first.next, copied.peek === first.peek);
const neverCalled = counter(7);
const ofNeverCalled = alone(neverCalled);
say("functions that nobody had read", ofNeverCalled.next === neverCalled.next, ofNeverCalled.next(), neverCalled.n, ofNeverCalled.twice());

// Instances, lists and other things are copied as what a spread makes of them.
class Pair { constructor(public left: number, public right: Point) {} sum() { return this.left + this.right.x; } }
const pair = new Pair(1, { x: 2, y: 3 });
const ofPair = withId(pair, 4);
say("an instance", ofPair, ofPair instanceof Pair, "sum" in ofPair, ofPair.right === pair.right, Object.getPrototypeOf(ofPair) === Object.prototype);
say("a list, a string, nothing", ofAnything([1, [2]], 3), ofAnything("ab", 1), ofAnything(null, 1), ofAnything(undefined, 2), ofAnything(7, 3));

// A copy of a copy of a copy, each changed.
let chain = withId(shape(1), 0);
const links = [chain];
for (let round = 1; round < 5; round++) {
    chain = withId(chain, round);
    chain.name += round;
    chain.at = { x: chain.at.x + 1, y: round };
    links.push(chain);
}
say("a chain", links.map((link) => link.id + link.name + link.at.x + link.at.y + measure(link)).join());
console.log(lines.join("\n"));
