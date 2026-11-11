// answers: without-library
// # under testing=CheckProofsAtRunTime a field that is read a second time is read again and held against what was remembered. Where both reads are known the comparison folds, and the Box of the second read is left as a pure operation that nothing reads. It names the BitAnd of the first read, which stands between two tests whether the slot is filled. The second test is decided by the first, so threadJumps() leads past that block: what the dead Box names no longer dominates it. The validator behind the block passes took that for a malformed procedure and stopped the build: nothing was wrong with the code.
// # OPTIONS: check=Validate testing=CheckProofsAtRunTime
// # x
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
const usual = { plain: false, wide: false, label: "usual" };
function settle(chosen: any = usual) { if (typeof chosen.plain !== "undefined" && typeof chosen.plain !== "boolean") throw new TypeError("plain must be true or false"); if (typeof chosen.wide !== "undefined" && typeof chosen.wide !== "boolean") throw new TypeError("wide must be true or false"); return (chosen.plain ? 1 : 0) + (chosen.wide ? 2 : 0); }
function outer(given: any = {}) { return settle(given); }
report(settle());
report(outer());
report(outer({ plain: true }));
report(outer({ wide: true, plain: false }));
report("end");
declare function report(value: unknown): void;
