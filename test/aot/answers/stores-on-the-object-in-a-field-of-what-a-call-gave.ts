// answers: without-library
// # `made.tag.mark = mark; made.tag.owner = other` on what `begin()` gave, which has stored `begun` on the same object: each body's run goes on where the body that gave the holder ended, so the image has `begun owner mark` for `turned()`
// # f2 = copyOf
// # RUN(ORDERS): plan orders mechanisms=all
// # ORDERS-LABEL: orders L0
// # ORDERS: order 1: | "begun" "owner" "mark"
// # ORDERS: order 2: | "begun" "hue"
// # each read of the field is followed by one look at the order word, the second of which knows what the first store has created, and the stores write the word that lists their key next
// # RUN(FORM): walk f2 mechanisms=all-Inlining
// # FORM-LABEL: code f2:Body
// # FORM: HasKeyOrder {{*}}layout=L0 fields=[0]
// # FORM: PutSlotOrAdd {{*}}key="mark" {{*}}orderWordAfter=
// # FORM: HasKeyOrder {{*}}layout=L0 fields=[0, 1]
// # FORM: PutSlotOrAdd {{*}}key="owner" {{*}}orderWordAfter=
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
class Tag { }
interface Tag { begun: number; mark: unknown; owner: Crate; hue: string; last: number; }
class Crate { tag!: Tag; size: number; constructor(size: number) { this.size = size; } }
function begin(size: number) { const crate = new Crate(size); crate.tag = new Tag(); crate.tag.begun = size > 2 ? 1 : 0; return crate; }
function copyOf(other: Crate, mark: unknown) { const hue = other.tag.hue; const made = begin(other.size); made.tag.mark = mark; made.tag.owner = other; if (hue) made.tag.hue = hue; return made; }
function painted(hue: string) { const made = begin(2); made.tag.hue = hue; return made; }
function turned(other: Crate) { const made = begin(3); made.tag.owner = other; made.tag.mark = "first"; return made; }
function swapped(other: Crate) { const made = begin(4); made.tag.owner = other; made.tag = new Tag(); made.tag.mark = "alone"; return made; }
function show(crate: Crate) { return Object.keys(crate).join() + " " + Object.keys(crate.tag).join(); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const plain = begin(1);
const red = painted("red");
tell(() => show(plain));
tell(() => show(red));
tell(() => show(copyOf(plain, 1)));
tell(() => show(copyOf(red, 2)));
tell(() => show(copyOf(copyOf(red, 3), 4)));
tell(() => show(turned(plain)));
tell(() => show(swapped(plain)));
tell(() => copyOf(red, "m").tag.mark);
tell(() => copyOf(red, "m").tag.owner === red);
tell(() => { const early = begin(5); early.tag.last = 1; const made = copyOf(early, 0); return show(early) + show(made); });
tell(() => { const frozen = begin(6); Object.freeze(frozen.tag); frozen.tag.owner = plain; return show(frozen); });
tell(() => { const gone = copyOf(red, 7); delete (gone.tag as any).owner; gone.tag.owner = plain; return show(gone); });
tell(() => { const shared = begin(8); const other = begin(9); other.tag = shared.tag; other.tag.owner = plain; shared.tag.mark = 1; return show(shared) + show(other); });
report("end");
