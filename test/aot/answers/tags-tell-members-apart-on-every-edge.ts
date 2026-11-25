// answers: without-library
// # the records as the front end writes them: a NarrowByField on both edges of a test of a tag and on each case of a switch, tags written as expected. On every edge the member whose written tag the edge leaves is expected, and its own name is a slot behind a test of its shape. A tag is a guess: tags that lie, tags stored over, other orders of keys and what is no object go by name
// # the functions are called out of a list, so nothing is proven of their parameters
// # f1 = area, f2 = byCase, f3 = byNumber, f4 = byNumberCase, f5 = byTruth, f6 = tell
// # RUN(FORM): walk f1 mechanisms=none+TypedOperations+Guesses
// # FORM-LABEL: code f1:Body
// # FORM: = GetSlot {{*}}key="radius"
// # FORM: = GetSlot {{*}}key="side"
// # RUN(CASES): walk f2 mechanisms=none+TypedOperations+Guesses
// # CASES-LABEL: code f2:Body
// # CASES: = GetSlot {{*}}key="radius"
// # CASES: = GetSlot {{*}}key="side"
// # RUN(NUMBER): walk f4 mechanisms=none+TypedOperations+Guesses
// # NUMBER-LABEL: code f4:Body
// # NUMBER: = GetSlot {{*}}key="text"
// # NUMBER: = GetSlot {{*}}key="left"
// # RUN(ALL): walk f1 mechanisms=all-ParameterGuards-Inlining
// # ALL-LABEL: code f1:Body
// # ALL: = GetSlot {{*}}key="radius"
// # ALL: = GetSlot {{*}}key="side"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 31 of 31 of 31
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 31 of 31 of 31
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=none+TypedOperations+Guesses $SHELL
// # ALSO2: 31 of 31 of 31
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
type Circle = { kind: "circle"; radius: number };
type Square = { kind: "square"; side: number };
type Leaf = { tag: 1; text: string };
type Pair = { tag: 2; left: string };
type Hit = { ok: true; value: string };
type Miss = { ok: false; error: string };
function area(s: Circle | Square) { if (s.kind === "circle") return s.radius; return s.side; }
function byCase(s: Circle | Square) { switch (s.kind) { case "circle": return s.radius; case "square": return s.side; } }
function byNumber(n: Leaf | Pair) { if (n.tag !== 1) return n.left; return n.text; }
function byNumberCase(n: Leaf | Pair) { switch (n.tag) { case 1: return n.text; case 2: return n.left; } }
function byTruth(r: Hit | Miss) { if (r.ok) return r.value; return r.error; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const functions: any[] = [area, byCase, byNumber, byNumberCase, byTruth];
const circle: Circle = { kind: "circle", radius: 2 };
const square: Square = { kind: "square", side: 3 };
const leaf: Leaf = { tag: 1, text: "t" };
const pair: Pair = { tag: 2, left: "l" };
const hit: Hit = { ok: true, value: "v" };
const miss: Miss = { ok: false, error: "e" };
report(functions.length);
tell(() => functions[0](circle));
tell(() => functions[0](square));
tell(() => functions[1](circle));
tell(() => functions[1](square));
tell(() => functions[2](leaf));
tell(() => functions[2](pair));
tell(() => functions[3](leaf));
tell(() => functions[3](pair));
tell(() => functions[4](hit));
tell(() => functions[4](miss));
tell(() => functions[0]({ kind: "circle", side: 7 }));
tell(() => functions[0]({ kind: "square", radius: 8 }));
tell(() => functions[0]({ kind: "triangle", side: 9 }));
tell(() => functions[0]({ radius: 10, kind: "circle" }));
tell(() => functions[1]({ kind: "circle", side: 11 }));
tell(() => functions[1]({ kind: "triangle", side: 12 }));
tell(() => functions[2]({ tag: 1, left: "a leaf that has no text" }));
tell(() => functions[2]({ tag: "1", left: "a text is no number" }));
tell(() => functions[3]({ tag: 2, text: "a pair that has no left" }));
tell(() => functions[4]({ ok: 1, value: "truthy" }));
tell(() => functions[4]({ ok: 0, value: "falsy", error: "falsy error" }));
tell(() => functions[0](null));
tell(() => functions[1](undefined));
tell(() => functions[2](7));
(circle as any).kind = "square";
tell(() => functions[0](circle));
tell(() => functions[1](circle));
(pair as any).tag = 1;
tell(() => functions[2](pair));
tell(() => functions[3](pair));
(hit as any).ok = false;
tell(() => functions[4](hit));
report("end");
