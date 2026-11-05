// answers: without-library
// # Typed records that hold themselves, straight or through a member of any type, are written as JSON. The writer throws at the ring, and a getter on the way there has run as often as it is reached: once.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
const log: string[] = [];
interface Ring { size: number; below: Ring[] }
const straight: Ring = { size: 0, below: [] };
interface Crate { before: unknown; held: Ring; after: unknown; self: Crate | null }
const crate: Crate = { before: null, held: straight, after: null, self: null };
crate.before = { get g() { log.push("getter"); return 1; } };
crate.after = { deep: { deeper: crate } };
crate.self = crate;
function written(value: unknown): string { log.length = 0; try { return JSON.stringify(value) + " " + log.join(); } catch (error) { return (error as Error).name + " " + log.join(); } }
report(written([crate, crate, crate])); report(written(crate)); report(written({ crate }));
const through: Crate = { before: null, held: straight, after: null, self: null };
through.before = { get g() { log.push("first"); return 1; } };
through.after = { get h() { log.push("second"); return through; } };
report(written(through)); report(written([straight, through]));
const open: Crate = { before: null, held: straight, after: null, self: null };
open.before = { get g() { log.push("once"); return 1; } };
open.after = { deep: { deeper: straight } };
report(written(open)); report(written([open, open]));
straight.below.push({ size: 1, below: [] });
report(written(open)); report(written(straight));
straight.below[0].below.push(straight);
report(written(straight)); report(written(open));
report("end");
