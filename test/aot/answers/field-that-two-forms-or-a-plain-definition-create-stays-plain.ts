// answers: without-library
// # Two descriptors in sight create `x` in two forms, and nobody knows the flag of the descriptor that creates `u`: neither field has a form, and each definition is the run time's.
// # RUN(NEVER): link fields mechanisms=all
// # NEVER-NOT: "x" appended{{*}} form=
// # NEVER-NOT: "u" appended{{*}} form=
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
function Two(this: any, v: number, how: boolean) { if (how) { Object.defineProperty(this, "x", { value: v }); } else { Object.defineProperty(this, "x", { value: v, writable: true, enumerable: true }); } }
function Unknown(this: any, v: number, flag: boolean) { Object.defineProperty(this, "u", { value: v, enumerable: flag }); }
let text = "";
for (let i = 0; i < 40; i++) { const two = new (Two as any)(i, (i & 1) === 1); const unknown = new (Unknown as any)(i, (i & 1) === 1); text = Object.keys(two).join() + Object.keys(unknown).join() + two.x + unknown.u; }
report(text);
report("end");
declare function report(value: unknown): void;
