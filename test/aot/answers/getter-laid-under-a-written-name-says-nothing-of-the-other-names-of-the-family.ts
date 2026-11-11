// answers: without-library
// # Two allocation sites meet and are one family from then on. A descriptor lays one getter on an object of one of them, under a name that is written.
// # The reads of the family's other names expect nothing: a lookup in front of each of them would find no getter in any run.
// # A helper fills the two objects: stored into under written names right behind Object.create(null), at the top of a file, they would be records and no allocation sites.
// # f1 = pick, f2 = fill, f3 = show, f4 = shape
// # RUN(HELD): link accesses held mechanisms=all
// # HELD: read f3 {{*}} expects getter f4
// # HELD-NOT: expects getter
// # RUN(WALK): walk f3 mechanisms=all
// # WALK-NOT: = GetCachedGetter {{*}}key="text"
// # WALK-NOT: = GetCachedGetter {{*}}key="size"
// # WALK: = GetCachedGetter {{*}}key="shape"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
function pick(one: any, other: any, first: boolean) { return first ? one : other; }
function fill(made: any, size: number, text: string) { made.size = size; made.text = text; return made; }
const plain: any = fill(Object.create(null), 1, "plain");
const marked: any = fill(Object.create(null), 2, "marked");
Object.defineProperty(marked, "shape", { get: function shape(this: any) { return this.text + this.size; } });
function show(first: boolean) { const picked = pick(plain, marked, first); return picked.text + ":" + picked.size + ":" + picked.shape; }
let text = "";
for (let i = 0; i < 300; i++) text = show((i & 1) === 0) + show((i & 1) === 1);
report(text);
report("end");
