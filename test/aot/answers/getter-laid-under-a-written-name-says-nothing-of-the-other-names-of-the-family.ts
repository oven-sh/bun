// answers: without-library
// # Two allocation sites meet and are one family from then on. A descriptor lays one getter on an object of one of them, under a name that is written.
// # The reads of the family's other names expect nothing: a lookup in front of each of them would find no getter in any run.
// # f1 = pick, f2 = show, f3 = shape
// # RUN(HELD): link accesses held mechanisms=all
// # HELD: read f2 {{*}} expects getter f3
// # HELD-NOT: expects getter
// # RUN(WALK): walk f2 mechanisms=all
// # WALK-NOT: = GetCachedGetter {{*}}key="text"
// # WALK-NOT: = GetCachedGetter {{*}}key="size"
// # WALK: = GetCachedGetter {{*}}key="shape"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
function pick(one: any, other: any, first: boolean) { return first ? one : other; }
const plain: any = Object.create(null);
plain.size = 1;
plain.text = "plain";
const marked: any = Object.create(null);
marked.size = 2;
marked.text = "marked";
Object.defineProperty(marked, "shape", { get: function shape(this: any) { return this.text + this.size; } });
function show(first: boolean) { const picked = pick(plain, marked, first); return picked.text + ":" + picked.size + ":" + picked.shape; }
let text = "";
for (let i = 0; i < 300; i++) text = show((i & 1) === 0) + show((i & 1) === 1);
report(text);
report("end");
