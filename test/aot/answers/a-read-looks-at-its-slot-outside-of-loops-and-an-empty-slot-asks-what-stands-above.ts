// answers: without-library
// # `held` is not of birth, and Box may be evaluated again, so no looks at the cell make an empty slot read undefined. Outside of loops a read of it looks at its slot as the last resort: filled, the slot answers;
// # empty, the read goes as it is written: a value or a getter above, another prototype, an accessor laid on the object, a deletion, the twin class, a stranger, a primitive and a proxy all answer as in the shell.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 30 of 30 of 30
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function make(): any { interface Box { tag: number; held?: unknown; } function Box(this: Box, value: unknown, fills: boolean) { this.tag = 1; if (fills) this.held = value; } Box.prototype.peek = function peek(this: Box) { return this.held; }; Box.prototype.both = function both(this: Box) { return [this.tag, this.held]; }; return Box; }
const Box = make();
const Twin = make();
const say = (label: string, answer: () => unknown) => { let said; try { said = JSON.stringify(answer()); } catch (error: any) { said = "throws " + error.constructor.name; } report(label + ": " + said); };
const full = new Box(5, true), empty = new Box(5, false), peek = full.peek, both = full.both;
say("filled", () => [full.peek(), full.both()]);
say("empty", () => [empty.peek(), empty.both()]);
say("the twin", () => [peek.call(new Twin(6, true)), both.call(new Twin(6, false)), new Twin(7, true).both()]);
say("a stranger", () => [peek.call({ held: "stranger" }), both.call({ held: "stranger", tag: "its tag" })]);
say("a stranger with more in front", () => both.call({ a: 1, b: 2, c: 3, d: 4, held: "far", tag: "farther" }));
say("an array", () => [peek.call([1, 2, 3]), both.call([1, 2, 3])]);
say("a function", () => both.call(function tag() {}));
say("a number", () => [peek.call(5), both.call(5)]);
say("a string", () => both.call("text"));
say("null", () => both.call(null));
say("undefined", () => peek.call(undefined));
say("a proxy", () => [peek.call(new Proxy({}, { get: (t, name) => "trap " + String(name) })), both.call(new Proxy({}, { get: (t, name) => "trap " + String(name) }))]);
const accessor = new Box(5, true); Object.defineProperty(accessor, "held", { get() { return "own getter"; }, configurable: true });
say("own accessor", () => [accessor.peek(), accessor.both()]);
const late = new Box(5, false); Object.defineProperty(late, "held", { get() { return "late getter"; } });
say("an accessor on an empty slot", () => [late.peek(), late.both()]);
const moved = new Box(5, false); Object.setPrototypeOf(moved, { held: "another prototype's", peek, both });
say("another prototype", () => [moved.peek(), moved.both()]);
const gone = new Box(5, true); delete gone.held;
say("deleted", () => [gone.peek(), gone.both()]);
gone.held = 9;
say("stored again", () => [gone.peek(), gone.both()]);
const noTag = new Box(5, true); delete noTag.tag;
say("the field of birth deleted", () => noTag.both());
say("frozen", () => Object.freeze(new Box(7, true)).both());
const holdsUndefined = new Box(undefined, true);
say("holds undefined", () => [holdsUndefined.peek() === undefined, "held" in holdsUndefined, holdsUndefined.both().length]);
say("an heir of an instance", () => [peek.call(Object.create(full)), both.call(Object.create(empty))]);
Box.prototype.held = "above";
say("filled, a value above", () => [full.peek(), full.both()]);
say("empty, a value above", () => [empty.peek(), empty.both()]);
say("the twin, a value above the other", () => [new Twin(1, false).peek(), new Twin(1, false).both()]);
say("holds undefined, a value above", () => holdsUndefined.peek() === undefined);
say("deleted, a value above", () => { const box = new Box(5, true); delete box.held; return [box.peek(), box.both()]; });
Object.defineProperty(Box.prototype, "held", { get() { return "getter above of " + this.tag; }, configurable: true });
say("filled, a getter above", () => [full.peek(), full.both()]);
say("empty, a getter above", () => [empty.peek(), empty.both()]);
say("born under a getter above", () => [new Box(8, true).peek(), new Box(8, true).both()]);
report("end");
