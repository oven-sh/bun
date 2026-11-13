// answers: without-library
// # `p[c ? "x" : "y"]`: the two arms meet in the block that takes the key. There the key is "x" | "y", and an access under it would be closed. The block is walked once for each way: on each the key is one text, and the access goes by that name. In loops: outside of them the access stays as it is written.
// # f1 = reads, f2 = stores, f3 = ofThree, f4 = once
// # RUN(READS): walk f1:Body mechanisms=all
// # READS-LABEL: code f1:Body
// # READS-NOT: = ElemGet
// # RUN(STORES): walk f2:Body mechanisms=all
// # STORES-LABEL: code f2:Body
// # STORES-NOT: = ElemSet
// # RUN(ONCE): walk f4:Body mechanisms=all
// # ONCE-LABEL: code f4:Body
// # ONCE: = ElemGet
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 13 of 13 of 13
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
class Point { x = 1; y = 2; z = 3; }
function reads(p: Point, n: number) { let s = 0; for (let i = 0; i < n; i++) s += p[i & 1 ? "x" : "y"]; return [s]; }
function stores(p: Point, n: number) { for (let i = 0; i < n; i++) p[i & 1 ? "x" : "y"] = i; return [p.x * 100 + p.y]; }
function ofThree(p: Point, n: number) { let s = 0; for (let i = 0; i < n; i++) s += p[i % 3 === 0 ? "x" : i % 3 === 1 ? "y" : "z"]; return [s]; }
function once(p: Point, n: number) { return [p[n & 1 ? "x" : "y"]]; }
function tell(f: () => unknown[]) { try { report(f()[0]); } catch (e) { report((e as Error).name); } }
tell(() => reads(new Point(), 5)); tell(() => stores(new Point(), 6)); tell(() => ofThree(new Point(), 7)); tell(() => once(new Point(), 1)); tell(() => once(new Point(), 2));
const odd: any = { get x() { return 10; }, y: "text" }; tell(() => reads(odd, 4)); tell(() => once(odd, 1)); tell(() => once(odd, 2));
tell(() => reads(null as any, 2)); tell(() => reads(null as any, 0)); tell(() => once(undefined as any, 1)); tell(() => stores(Object.freeze(new Point()), 2));
report("end");
