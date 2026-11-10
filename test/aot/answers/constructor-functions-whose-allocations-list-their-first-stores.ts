// answers: without-library
// # where the body of a constructor function is copied, the allocation lists what the head of the body stores. The answers turn on what stands above the new cell, on the order of the keys and on who sees the object half made
// # each deed goes by a name out of JSON.parse, so Link sees none of them, and each has a function of its own: a guard that has ended once would hide the next deed
// # f15 = make, f16 = makeBelow, f18 = makeMoved, f20 = makeFew, f22 = makeSelf, f23 = makeHalf, f24 = makeTwice, f27 = makeSighted
// # nothing is written of these fields, so their slots are held to what is seen stored in them, and an allocation lists no value that is not proven to fit its slot. The forms, and a second run of the answers, are those with the typed slots withheld.
// # `parent` is stored undefined and nothing more in sight: whoever fills it is not seen, and its slot is held to nothing.
// # RUN(UNSEEN): facts enforced mechanisms=all
// # UNSEEN: "kind" source=seen
// # UNSEEN-NOT: "parent"
// # RUN(FORM): walk f15 mechanisms=-TypedSlots
// # FORM-LABEL: code f15:Body
// # FORM: = NewObject {{*}}fields=[0, 1, 2, 3, 4, 5]
// # RUN(BELOW): walk f16 mechanisms=-TypedSlots
// # BELOW-LABEL: code f16:Body
// # BELOW: = AreMembersUnchanged
// # BELOW: = NewObject {{*}}fields=[0, 1, 2]
// # RUN(MOVED): walk f18 mechanisms=-TypedSlots
// # MOVED-LABEL: code f18:Body
// # MOVED: = NewObject {{*}}fields=[0, 1, 2]
// # MOVED: = HasLayoutPrototype
// # `this` itself, a call and an argument that is missing each end the row: the allocation lists what stands in front, and the stores behind it create their fields in their order. ALL OR NOTHING OF THAT ROW: where one of its values does not fit its slot, or a name is stored twice, it lists nothing
// # RUN(FEW): walk f20 mechanisms=all
// # FEW-LABEL: code f20:Body
// # FEW: = NewObject {{*}}fields=[0]
// # FEW: = PutSlotOrAdd {{*}}key="b"
// # FEW: = PutSlotOrAdd {{*}}key="c"
// # RUN(SELF): walk f22 mechanisms=all
// # SELF-LABEL: code f22:Body
// # (`o.self === o` is a value compared with itself: it folds, nothing needs the object any more, and the sweep takes the allocation with its stores. The answers say the rest.)
// # SELF-NOT: = NewObject
// # RUN(HALF): walk f23 mechanisms=all
// # HALF-LABEL: code f23:Body
// # HALF: = NewObject {{*}}fields=[0]
// # RUN(TWICE): walk f24 mechanisms=all
// # TWICE-LABEL: code f24:Body
// # TWICE-NOT: = NewObject {{*}}fields=[
// # a setter that is laid above in plain sight, by one written descriptor, takes the first store: the record of the class expects it there,
// # so the allocation lists nothing, and the store goes by name on the likely way, not behind a guard that never holds (answers 26 and 27)
// # RUN(SIGHTED): walk f27 mechanisms=all
// # SIGHTED-NOT: = NewObject {{*}}fields=[
// # SIGHTED: = PropSet {{*}}key="a"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 28 of 28 of 28
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
// # RUN(LISTED): run-in-shell mechanisms=-TypedSlots $SHELL
// # LISTED: 28 of 28 of 28
// # LISTED-NEXT: exited with 0
const hidden = JSON.parse('{"define":"defineProperty","lift":"setPrototypeOf","a":"a","b":"b","prototype":"prototype"}');
let log = "";
let seen = "";
function show(o: any) { const text = Object.keys(o).join() + " " + JSON.stringify(o) + log; log = ""; return text; }
function attempt(run: (value?: any) => unknown, value?: unknown) { try { return show(run(value)); } catch (e) { const text = (e as Error).name + log; log = ""; return text; } }
function Node(this: any, kind: number, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; this.flags = 0; this.parent = undefined; }
function make(kind: number) { return new (Node as any)(kind, -1, kind + 1); }
function Below(this: any, a: unknown, b: unknown) { this.a = a; this.b = b; this.c = "c"; }
function makeBelow(a: unknown) { return new (Below as any)(a, 2); }
function Fixed(this: any, a: unknown, b: unknown) { this.a = a; this.b = b; this.c = "c"; }
function makeFixed(a: unknown) { return new (Fixed as any)(a, 2); }
function Moved(this: any, a: unknown, b: unknown) { this.a = a; this.b = b; this.c = "c"; }
function makeMoved(a: unknown) { return new (Moved as any)(a, 2); }
function Lifted(this: any, a: unknown, b: unknown) { this.a = a; this.b = b; this.c = "c"; }
function makeLifted(a: unknown) { return new (Lifted as any)(a, 2); }
function Few(this: any, a: unknown, b: unknown) { this.a = a; this.b = b; this.c = 1; }
function makeFew() { return new (Few as any)(1); }
function Returns(this: any, other: unknown) { this.own = 1; return other; }
function makeReturns(other: unknown) { return new (Returns as any)(other); }
function Self(this: any, v: unknown) { this.v = v; this.self = this; this.w = v; }
function makeSelf(v: unknown) { const o = new (Self as any)(v); return (o.self === o) + " " + Object.keys(o).join(); }
function note(o: any) { seen += Object.keys(o).join() + ";"; }
function Half(this: any, a: unknown, b: unknown) { this.a = a; note(this); this.b = b; }
function makeHalf() { return new (Half as any)(1, 2); }
function Twice(this: any, v: unknown) { this.a = v; this.b = v; this.a = 2; }
function makeTwice(v: unknown) { return new (Twice as any)(v); }
function Parent(this: any, a: unknown) { this.a = a; this.b = 0; }
class Child extends (Parent as any) { constructor() { super(7); } }
function makeChild() { return new Child(); }
function Sighted(this: any, a: unknown) { this.a = a; this.b = 1; }
function makeSighted(a: unknown) { return new (Sighted as any)(a); }
for (let turn = 0; turn < 3; turn++) report(attempt(make, turn));
for (let turn = 0; turn < 3; turn++) report(attempt(makeBelow, turn));
(Object as any)[hidden.define](Below.prototype, hidden.a, { set(value: any) { log += " set " + value; }, configurable: true });
report(attempt(makeBelow, 3));
delete Below.prototype[hidden.a];
report(attempt(makeBelow, 4));
report(attempt(makeFixed, 0));
(Object as any)[hidden.define](Fixed.prototype, hidden.b, { value: 9, writable: false, configurable: true });
report(attempt(makeFixed, 1));
report(attempt(makeMoved, 0));
(Moved as any)[hidden.prototype] = { set b(value: any) { log += " above " + value; } };
report(attempt(makeMoved, 1));
report(attempt(makeLifted, 0));
(Object as any)[hidden.lift](Lifted.prototype, { set a(value: any) { log += " lifted " + value; } });
report(attempt(makeLifted, 1));
report(attempt(makeFew));
report(attempt(makeFew));
const given = { given: true };
report(makeReturns(given) === given);
report(attempt(makeReturns, 5));
report(makeSelf(3));
report(makeSelf("w"));
report(attempt(makeHalf) + " " + seen);
report(attempt(makeHalf) + " " + seen);
report(attempt(makeTwice, 1));
report(attempt(makeTwice, "t"));
report((makeChild() instanceof Child) + " " + (Object.getPrototypeOf(makeChild()) === Child.prototype) + " " + show(makeChild()));
Object.defineProperty(Sighted.prototype, "a", { set(value: any) { log += " sighted " + value; }, configurable: true });
report(attempt(makeSighted, 1));
report(attempt(makeSighted, 2));
report("end");
