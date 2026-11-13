// answers: without-library
// # `class Node { next: Node; prev: Node; weight: number; constructor(w) { this.next = this; this.prev = this; this.weight = w; } }`: a store of the object into itself joins the row where the row is plain (a simple parameter
// # list, nothing between, every other value a bare parameter or a written constant), so the links are cells and the weight is a number. What must stay: a call in front, a call behind, a value that branches, a default, a read
// # through the link, a look at the object: there the row ends as it did, and every answer is the same.
// # f3 = total
// # RUN(FORM): walk f3 mechanisms=all
// # FORM-LABEL: code f3:Body
// # FORM: : L0|L10 @Cell32 = GetSlot {{*}}key="next"
// # FORM: : number @Double = GetSlot {{*}}key="weight"
// # FORM-NOT: RequireObjectCoercible
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const seen: string[] = [];
function look(object: object): number { seen.push(Object.keys(object).join()); return seen.length; }

class Node { next: Node; prev: Node; weight: number; constructor(weight: number) { this.next = this; this.prev = this; this.weight = weight; } }
function chain(count: number): Node { const head = new Node(0); for (let i = 1; i < count; i++) { const node = new Node(i + 0.5); node.prev = head.prev; node.next = head; head.prev.next = node; head.prev = node; } return head; }
function total(head: Node): number { let sum = 0; for (let at = head.next; at !== head; at = at.next) sum += at.weight; return sum; }
report(total(chain(6)));
report(Object.keys(new Node(1)).join() + (new Node(1).next instanceof Node) + (new Node(2).prev.weight));

class Last { weight: number; self: Last; constructor(weight: number) { this.weight = weight; this.self = this; } }
report(new Last(3).self.self.weight + Object.keys(new Last(1)).join());

class Hidden { #me: Hidden; n: number; constructor(n: number) { this.#me = this; this.n = n; } me(): Hidden { return this.#me; } }
report(new Hidden(4).me().me().n);

class Asserted { me: unknown; n: number; constructor(n: number) { this.me = this as unknown; this.n = n; } }
report((new Asserted(5).me as Asserted).n);

class CallBehind { me: CallBehind; n: number; m: number; constructor(n: number) { this.me = this; this.n = n; look(seen); this.m = n; } }
report(JSON.stringify(Object.keys(new CallBehind(1))) + new CallBehind(2).me.m);

class CallInFront { me: CallInFront; n: number; constructor(n: number) { look(seen); this.me = this; this.n = n; } }
report(Object.keys(new CallInFront(1)).join() + new CallInFront(2).me.n);

class ValueBranches { me: ValueBranches; n: number; constructor(n: number) { this.me = this; this.n = n > 0 ? n : -n; } }
report(new ValueBranches(-3).me.n);

class ReadsThrough { me: ReadsThrough; early: unknown; late: number; constructor(late: number) { this.me = this; this.early = this.me.late; this.late = late; } }
report(String(new ReadsThrough(1).early) + new ReadsThrough(2).late);

class Defaults { me: Defaults; n: number; constructor(n: number = 7) { this.me = this; this.n = n; } }
report(new Defaults().me.n + new Defaults(1).me.n);

class HandsOut { me: HandsOut; n: number; constructor(n: number) { this.me = this; look(this); this.n = n; } }
report(new HandsOut(1).n + seen.splice(0).join("|"));

class Below extends Node { extra: number; constructor() { super(1.5); this.extra = this.next.weight; } }
report(new Below().extra);
report("end");
