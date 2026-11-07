// answers: without-library
// # Two descriptors lay two functions on one object, each under a name that is written. A definition under a written name speaks of the reads of that name and of no other:
// # each read expects its own getter, and the read of a name that no descriptor names expects none.
// # f1 = make, f2 = both, f3 = area, f4 = rim
// # RUN(HELD): link accesses held mechanisms=all
// # HELD: read f2 {{*}} expects getter f3
// # HELD-NEXT: read f2 {{*}} expects getter f4
// # HELD-NOT: expects getter
// # IT IS AN EXPECTATION: what is proven says nothing of it.
// # RUN(PROVEN): link accesses mechanisms=all
// # PROVEN-NOT: expects getter
// # RUN(OLDEST): link accesses held oldest-first mechanisms=all
// # OLDEST: read f2 {{*}} expects getter f3
// # OLDEST-NEXT: read f2 {{*}} expects getter f4
// # The code that reads looks each name up without running code, tests what it finds, and goes on with the getter itself.
// # RUN(WALK): walk f2 mechanisms=all
// # WALK: = GetCachedGetter {{*}}key="area"
// # WALK: = TypeTest {{*}}testedType=f3
// # WALK: = GetCachedGetter {{*}}key="rim"
// # WALK: = TypeTest {{*}}testedType=f4
// # WALK-NOT: = GetCachedGetter {{*}}key="width"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
function make(width: number, height: number): any { const made: any = Object.create(null); made.width = width; made.height = height; Object.defineProperty(made, "area", { get: function area(this: any) { return this.width * this.height; }, enumerable: true }); Object.defineProperty(made, "rim", { get: function rim(this: any) { return 2 * (this.width + this.height); }, enumerable: true }); return made; }
const holder = make(3, 4);
function both() { return holder.area + holder.rim + holder.width; }
let sum = 0;
for (let i = 0; i < 300; i++) sum += both();
report(sum);
report("end");
