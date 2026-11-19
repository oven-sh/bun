// answers: without-library
// # `class Cell { left: Cell = this; right: Cell = this; .. }`: the store of an object into its own field shows it to nobody, so the links of a ring are read as cells, not as "a cell or nothing". What must stay: a read off the
// # object under such a key shows it: in a field behind, in the body, inside try, by destructuring, in a class below, under a private name; a store in a loop comes round to a read; a setter above takes the store; a computed key,
// # a parent that gives another object or a Proxy.
// # f2 = around
// # RUN(FORM): walk f2 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: : L0 @Cell32 = GetSlot {{*}}key="right"
// # FORM-NOT: GetSlotOrUndefined
// # FORM-NOT: RequireObjectCoercible
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 16 of 16 of 16
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const log: string[] = [];

class Cell { left: Cell = this; right: Cell = this; size: number; constructor(size: number) { this.size = size; } }
function ring(count: number): Cell { const head = new Cell(0); for (let i = 1; i < count; i++) { const cell = new Cell(i + 0.5); cell.left = head.left; cell.right = head; head.left.right = cell; head.left = cell; } return head; }
function around(head: Cell): number { let sum = 0; for (let at = head.right; at !== head; at = at.right) sum += at.size; return sum; }
report(around(ring(6)));

class InBody { next: InBody; weight: number; constructor(weight: number) { this.next = this; this.weight = weight; } }
function twice(list: InBody[]): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].next.weight + list[i].weight; return sum; }
report(twice([new InBody(1.5), new InBody(2.5)]));

class ReadsEarly { #me: any = this; #x: unknown = this.#me.late; late = 3; get x(): unknown { return this.#x; } }
report(String(new ReadsEarly().x) + ":" + new ReadsEarly().late);

class CallsThroughItself { next: any = this; seen: unknown; b: number; constructor() { try { this.next.m(); } catch { this.seen = this.next.b; } this.b = 4; } }
report(String(new CallsThroughItself().seen) + ":" + new CallsThroughItself().b);

class GivesBack { constructor(other: object) { return other; } }
class OnAnother extends GivesBack { next: any = this; constructor(other: object) { super(other); (this as any).b = 5; } }
const older: any = { set b(value: number) { this.heard = value; } };
const onOlder = new OnAnother(older);
report((onOlder === older) + ":" + (older.next === older) + ":" + older.heard);

class HoldsItself { self: any = this; a = 1; }
class TakesApart extends HoldsItself { c: unknown; d: number; constructor() { super(); const { self } = this; this.c = self.d; this.d = 6; } }
report(String(new TakesApart().c) + ":" + new TakesApart().d);

class ByComputedKey { e: unknown; f: number; constructor() { (this as any)["ne" + "xt"] = this; this.e = (this as any).next.f; this.f = 7; } }
report(String(new ByComputedKey().e) + ":" + new ByComputedKey().f);

class GivesProxy { constructor() { return new Proxy(this, { set(target: any, key: string, value: unknown) { log.push(key + (typeof value === "object" && value !== null && "z" in value)); target[key] = value; return true; } }); } }
class OnProxy extends GivesProxy { constructor() { super(); (this as any).next = this; (this as any).z = 1; } }
report((new OnProxy() as any).z + log.splice(0).join());

class ReadsBelow extends InBody { early: unknown; late: number; constructor() { super(1); this.early = (this.next as ReadsBelow).late; this.late = 2; } }
report(String(new ReadsBelow().early) + ":" + new ReadsBelow().late);

const heard: unknown[] = [];
class HasSetter { set next(value: any) { heard.push(value.b); } }
class StoresThroughSetter extends HasSetter { b: number; constructor() { super(); this.next = this; this.b = 1; } }
report(new StoresThroughSetter().b + ":" + String(heard.pop()));

class InALoop { next: InALoop | null = null; n: number; constructor(turns: number) { for (let i = 0; i < turns; i++) { if (this.next) heard.push((this.next as any).n); this.next = this; } this.n = 5; } }
report(new InALoop(2).n + ":" + String(heard.pop()));

class CountsInALoop { constructor(turns: number) { const self = this as any; self.seen = 0; for (let i = 0; i < turns; i++) { if (i) self.seen += self.next.b === undefined ? 1 : 2; self.next = this; } self.b = 5; } }
report((new CountsInALoop(3) as any).seen + ":" + (new CountsInALoop(3) as any).b + Object.keys(new CountsInALoop(3)).join());

class EarlyInFields { next: any = this; early: unknown = this.next.late; late = 1; }
report(String(new EarlyInFields().early) + ":" + new EarlyInFields().late);

class Above { next: any = this; a = 1; }
class BelowInFields extends Above { b: unknown = this.next.c; c = 2; }
report(String(new BelowInFields().b) + ":" + new BelowInFields().c);

const peek = (object: any): unknown => object.b;
class HandsItselfOut { next: any = this; a: unknown = peek(this); b = 2; }
report(String(new HandsItselfOut().a) + ":" + new HandsItselfOut().b);
report("end");
