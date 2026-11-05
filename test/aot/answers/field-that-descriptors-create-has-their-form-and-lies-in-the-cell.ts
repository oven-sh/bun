// answers: without-library
// # `Object.defineProperty(made, "b", { value: turn, enumerable: true })`, with the descriptor in sight and its flags written as constants: the field that Link appends has the one form that its definitions create, its slot lies in the cell, and a definition fills the slot: the property never leaves it.
// # RUN(FORMS): link fields mechanisms=all
// # FORMS: field L0.{{*}} "y" appended{{*}} form=not-enumerable.not-configurable.
// # FORMS: field L0.{{*}} "b" appended{{*}} form=read-only.not-configurable.
// # FORMS: field L0.{{*}} "c" appended{{*}} form=not-enumerable.accessor.
// # FORMS: field L0.{{*}} "z" appended{{*}} form=read-only.not-enumerable.not-configurable.
// # RUN(PLAN): plan layouts mechanisms=all
// # PLAN: slot {{*}} "b" appended JSValue Inline
// # PLAN: slot {{*}} "c" appended JSValue Inline {{*}}accessor
// # RUN(NEVER): plan layouts mechanisms=all
// # NEVER-NOT: "z" appended {{*}}may-exist-without-storage
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
function describe(made: object, turn: number) { Object.defineProperty(made, "b", { value: turn, enumerable: true }); Object.defineProperty(made, "c", { get() { return 2; }, configurable: true }); Object.defineProperty(made, "y", { value: turn, writable: true }); Object.defineProperty(made, "z", { value: 3 }); }
function passOn(made: object, turn: number) { describe(made, turn); }
function Made(this: any, turn: number) { passOn(this, turn); }
let sum = 0;
for (let turn = 0; turn < 200; turn++) { const made = new (Made as any)(turn); sum += made.b + made.c + made.y + made.z; }
report(sum);
const one = new (Made as any)(7);
report(Object.keys(one).join());
report(Object.getOwnPropertyNames(one).join());
one.y = 9;
report(one.y);
report(JSON.stringify(Object.getOwnPropertyDescriptor(one, "z")));
report("end");
