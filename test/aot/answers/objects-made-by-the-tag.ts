// answers: without-library
// # the objects of a tagged maker answer alike whichever layout their tag has picked: a tag that is known at `new`, one that only the entry sees, one that no member lists, and what is no tag at all
// # f1 = NodeMaker, f2 = ofAnyKind, f3 = ofNum, f4 = ofStr, f5 = ofLevel, f6 = describe, f7 = held, f8 = tell
// # the prototype object is read off the maker by the maker's own layout, so only the allocation may not name it
// # RUN(FORM): walk f3 mechanisms=all
// # FORM-LABEL: code f3:Body
// # FORM: = NewObject {{*}}layout=
// # RUN(NEVER): walk f3 mechanisms=all
// # NEVER-NOT: = NewObject {{*}}layout=L0
// # RUN(ENTRY): walk f1:AllocatingConstructEntry mechanisms=all
// # ENTRY: Switch {{*}}cases=[1, 2, 3, 4]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 24 of 24 of 24
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-TypedSlots $SHELL
// # ALSO1: 24 of 24 of 24
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
interface Low extends Base { kind: 3; level: number }
interface High extends Base { kind: 4; level: number }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function ofAnyKind(kind: number, pos: number): Base { return new Node(kind, pos); }
function ofNum(pos: number): Num { const n = new Node(1, pos) as Num; n.value = pos * 2; return n; }
function ofStr(pos: number): Str { const s = new Node(2, pos) as Str; s.text = "t" + pos; return s; }
function ofLevel(kind: 3 | 4, pos: number): Low | High { const l = new Node(kind, pos) as Low | High; l.level = kind * 10; return l; }
function describe(n: Base): string { return typeof n.kind + " " + String(n.kind) + ":" + n.pos + ":" + Object.keys(n).join(); }
function held(n: Base): unknown { if (n.kind === 1) return (n as Num).value; if (n.kind === 2) return (n as Str).text; if (n.kind === 3 || n.kind === 4) return (n as Low).level; return "none"; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => describe(ofNum(1)) + " " + held(ofNum(1)));
tell(() => describe(ofStr(2)) + " " + held(ofStr(2)));
tell(() => describe(ofLevel(3, 3)) + " " + held(ofLevel(3, 3)));
tell(() => describe(ofLevel(4, 4)) + " " + held(ofLevel(4, 4)));
tell(() => describe(ofAnyKind(1, 5)) + " " + held(ofAnyKind(1, 5)));
tell(() => describe(ofAnyKind(2, 5)) + " " + held(ofAnyKind(2, 5)));
tell(() => describe(ofAnyKind(4, 5)) + " " + held(ofAnyKind(4, 5)));
tell(() => describe(ofAnyKind(9, 5)) + " " + held(ofAnyKind(9, 5)));
tell(() => describe(ofAnyKind(1.5, 5)));
tell(() => describe(ofAnyKind(-0, 5)) + " " + Object.is(ofAnyKind(-0, 5).kind, -0));
tell(() => describe(ofAnyKind(NaN, 5)));
tell(() => describe(ofAnyKind("1" as any, 5)) + " " + held(ofAnyKind("1" as any, 5)));
tell(() => describe(ofAnyKind(undefined as any, 5)));
tell(() => describe(ofAnyKind(null as any, 5)));
tell(() => describe(ofAnyKind(true as any, 5)));
tell(() => describe(ofAnyKind({ valueOf() { return 1; } } as any, 5)));
tell(() => describe(new (Node as any)()));
tell(() => ofNum(1) instanceof Node && ofAnyKind(2, 1) instanceof Node && ofAnyKind(9, 1) instanceof Node);
tell(() => Object.getPrototypeOf(ofNum(1)) === NodeMaker.prototype && Object.getPrototypeOf(ofAnyKind(3, 1)) === NodeMaker.prototype);
tell(() => { let sum = 0; for (let i = 0; i < 400; i++) { const n = ofAnyKind(i % 6, i); sum += n.kind * 3 + n.pos; if (n.kind === 1) (n as Num).value = i; sum += Object.keys(n).length; } return sum; });
tell(() => { const n = ofAnyKind(1, 7) as Num; n.value = 3; (n as any).kind = 2; return describe(n) + " " + held(n); });
tell(() => { const n = ofNum(7); delete (n as any).kind; return describe(n) + " " + ("kind" in n); });
tell(() => { const s = ofStr(8); (s as any).value = 1; (s as any).level = 2; return describe(s); });
report("end");
