// answers: without-library
// # the text of records made in two orders, of objects with and without an optional field, of a chain of one layout, of classes with private names and methods, of unions, dates and lists is that of the interpreter, character by character
// # RUN(PLAN): json-plan mechanisms=all
// # PLAN: order "x" "y"
// # PLAN: order "y" "x"
// # RUN(TREE): json-plan mechanisms=all
// # TREE: whole calls-serializers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 22 of 22 of 22
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 22 of 22 of 22
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-BuiltinCalls $SHELL
// # ALSO2: 22 of 22 of 22
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-TypedSlots $SHELL
// # ALSO3: 22 of 22 of 22
// # ALSO3-NEXT: exited with 0
// # RUN(ALSO4): run-in-shell mechanisms=-Inlining-EscapeAnalysis $SHELL
// # ALSO4: 22 of 22 of 22
// # ALSO4-NEXT: exited with 0
declare function report(value: unknown): unknown;
type Point = { x: number; y: number };
type User = { name: string; nick?: string; at: Point | null; tags: string[] };
type Tree = { v: number; next?: Tree };
type Mixed = { v: string | number | boolean | null | undefined; f: () => number; s: symbol };
class Box { w = 1; h = 2.5; label = "b\"x\\\n "; #hidden = 3; area() { return this.w * this.h + this.#hidden; } }
class Lid extends Box { open = false; }
function point(x: number, y: number): Point { return { x, y }; }
function turned(x: number, y: number): Point { return { y, x }; }
function user(name: string, nick?: string): User { return nick === undefined ? { name, at: null, tags: [] } : { name, nick, at: point(1, 2), tags: [nick, name] }; }
function chain(depth: number): Tree { let tree: Tree = { v: 0 }; for (let v = 1; v <= depth; ++v) tree = { v, next: tree }; return tree; }
function mixed(v: Mixed["v"]): Mixed { return { v, f: () => 1, s: Symbol.iterator }; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => JSON.stringify(point(1, 2)));
tell(() => JSON.stringify(turned(1, 2)));
tell(() => JSON.stringify(point(-0, 1e21)));
tell(() => JSON.stringify(point(NaN, -Infinity)));
tell(() => JSON.stringify(point(2 ** 53, 0.1)));
tell(() => JSON.stringify(user("a")));
tell(() => JSON.stringify(user("a", "\ud800")));
tell(() => JSON.stringify(chain(0)));
tell(() => JSON.stringify(chain(3)));
tell(() => JSON.stringify(chain(300)).length);
tell(() => JSON.stringify(new Box()));
tell(() => JSON.stringify(new Lid()));
tell(() => JSON.stringify(mixed("t")));
tell(() => JSON.stringify(mixed(7)));
tell(() => JSON.stringify(mixed(true)));
tell(() => JSON.stringify(mixed(null)));
tell(() => JSON.stringify(mixed(undefined)));
tell(() => JSON.stringify({ at: new Date(0), bad: new Date(NaN) }));
tell(() => { let text = ""; for (let i = 0; i < 3; ++i) text += JSON.stringify(point(i, -i)); return text; });
tell(() => JSON.stringify([point(1, 2), turned(3, 4), null, undefined, () => 1]));
tell(() => JSON.stringify({}));
report("end");
