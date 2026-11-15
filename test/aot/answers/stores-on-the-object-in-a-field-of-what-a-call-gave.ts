// answers: without-library
// # `result.links.target = from; result.links.mapper = mapper` on what `create()` gave, which has stored `check` on the same object: each body's run goes on where the body that gave the holder ended, so the image has `check mapper target` for `turned()`
// # f2 = instantiate
// # RUN(ORDERS): plan orders mechanisms=all
// # ORDERS-LABEL: orders L0
// # ORDERS: order 1: | "check" "mapper" "target"
// # ORDERS: order 2: | "check" "label"
// # each read of the field is followed by one look at the order word, the second of which knows what the first store has created, and the stores write the word that lists their key next
// # RUN(FORM): walk f2 mechanisms=all-Inlining
// # FORM-LABEL: code f2:Body
// # FORM: HasKeyOrder {{*}}layout=L0 fields=[0]
// # FORM: PutSlotOrAdd {{*}}key="target" {{*}}orderWordAfter=
// # FORM: HasKeyOrder {{*}}layout=L0 fields=[0, 1]
// # FORM: PutSlotOrAdd {{*}}key="mapper" {{*}}orderWordAfter=
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none+TypedOperations+Guesses $SHELL
// # ALSO1: 14 of 14 of 14
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO2: 14 of 14 of 14
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
class Links { }
interface Links { check: number; target: Holder; mapper: unknown; label: string; late: number; }
class Holder { links!: Links; flags: number; constructor(flags: number) { this.flags = flags; } }
function create(flags: number, check?: number) { const made = new Holder(flags); made.links = new Links(); made.links.check = check || 0; return made; }
function instantiate(from: Holder, mapper: unknown) { const result = create(from.flags, 1); result.links.target = from; result.links.mapper = mapper; if (from.links.label) result.links.label = from.links.label; return result; }
function labeled(label: string) { const result = create(2); result.links.label = label; return result; }
function turned(from: Holder) { const result = create(3); result.links.mapper = "first"; result.links.target = from; return result; }
function swapped(from: Holder) { const result = create(4); result.links.target = from; result.links = new Links(); result.links.mapper = "alone"; return result; }
function show(holder: Holder) { return Object.keys(holder).join() + " " + Object.keys(holder.links).join(); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const plain = create(1);
const named = labeled("name");
tell(() => show(plain));
tell(() => show(named));
tell(() => show(instantiate(plain, 1)));
tell(() => show(instantiate(named, 2)));
tell(() => show(instantiate(instantiate(named, 3), 4)));
tell(() => show(turned(plain)));
tell(() => show(swapped(plain)));
tell(() => instantiate(named, "m").links.mapper);
tell(() => instantiate(named, "m").links.target === named);
tell(() => { const early = create(5); early.links.late = 1; const result = instantiate(early, 0); return show(early) + show(result); });
tell(() => { const frozen = create(6); Object.freeze(frozen.links); frozen.links.target = plain; return show(frozen); });
tell(() => { const gone = instantiate(named, 7); delete (gone.links as any).target; gone.links.target = plain; return show(gone); });
tell(() => { const shared = create(8); const other = create(9); other.links = shared.links; other.links.target = plain; shared.links.mapper = 1; return show(shared) + show(other); });
report("end");
