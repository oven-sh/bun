// answers: with-library
// # function makesObject(k) { if (k < 2) return null; return { k }; }: the way that returns at once needs nothing of a frame. What makes the object is a patch that needs one, but no call for liveness (it keeps the registers),
// # and the registers suffice: the search for the framed part took that for "no frame at all", the allocator found the need later, and the frame was set up at the entry for every activation.
// # The framed part is looked for wherever some patch needs a frame: the frame is set up at the head of the part that makes, joins, looks up or throws.
// # RUN(OBJECT): allocate f1:Body
// # REQUIRES(OBJECT): as-written
// # OBJECT: headOfFramedPart =
// # RUN(TEXT): allocate f3:Body
// # REQUIRES(TEXT): as-written
// # TEXT: headOfFramedPart =
// # RUN(THROW): allocate f5:Body
// # REQUIRES(THROW): as-written
// # THROW: headOfFramedPart =
// # Both ways of each function; so many objects, lists, closures and texts that the collector runs while the frame set up late stands; what is thrown inside the framed part is caught outside, and by a handler around.
// # RUN: run-in-shell $SHELL
// # CHECK: 16 of 16 of 16
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;

const table = new Map<number, number>([[2, 20], [3, 30]]);
function makesObject(k: number) { if (k < 2) return null; return { k }; }
function makesList(k: number) { if (k < 2) return null; return [k, k + 1]; }
function joinsTexts(a: string, k: number) { if (k < 2) return a; return a + "x"; }
function looksUp(inTable: Map<number, number>, k: number) { if (k < 2) return k; return inTable.get(k); }
function readsUnit(a: string, k: number) { if (k < 2) return k; return a.charCodeAt(k); }
function makesClosure(k: number) { if (k < 2) return null; return () => k; }
function throwsLate(k: number) { if (k < 2) return k; if (k > 1000) throw new RangeError("far " + k); return k + 1; }
function attempt(run: () => unknown) { try { return run(); } catch (error) { return (error as Error).name + ": " + (error as Error).message; } }
for (let k = 0; k < 5; k++) report([JSON.stringify(makesObject(k)), JSON.stringify(makesList(k)), joinsTexts("a", k), looksUp(table, k), readsUnit("abcd", k), typeof makesClosure(k), throwsLate(k)].join());
report(attempt(() => throwsLate(1001))); report(attempt(() => throwsLate(1))); report(attempt(() => throwsLate(1000)));
function sumsObjects(turns: number) { let s = 0; for (let i = 0; i < turns; i++) { const made = makesObject(i & 3); if (made) s += made.k; } return s; }
function sumsLists(turns: number) { let s = 0; for (let i = 0; i < turns; i++) { const made = makesList(i & 3); if (made) s += made[0] + made[1]; } return s; }
function sumsClosures(turns: number) { let s = 0; for (let i = 0; i < turns; i++) { const made = makesClosure(i & 3); if (made) s += made(); } return s; }
function growsText(turns: number) { let a = ""; for (let i = 0; i < turns; i++) a = joinsTexts(a, i & 3); return a.length; }
function countsThrown(turns: number) { let thrown = 0, s = 0; for (let i = 0; i < turns; i++) { try { s += throwsLate(i % 7 ? i & 3 : 2000 + i); } catch (error) { thrown += (error as Error).message.length; } } return thrown + "," + s; }
report(sumsObjects(400000)); report(sumsLists(400000)); report(sumsClosures(400000)); report(growsText(200000)); report(countsThrown(30000));
const kept: unknown[] = [];
for (let i = 0; i < 60000; i++) { kept.push(makesObject(i & 7), makesList(i & 7), makesClosure(i & 7)); if (kept.length > 3000) kept.length = 0; }
report(kept.length + " " + JSON.stringify(kept[kept.length - 3]) + " " + JSON.stringify(kept[kept.length - 2]) + " " + (kept[kept.length - 1] as () => number)());
report([looksUp(table, 2), looksUp(table, 3), looksUp(table, 4), looksUp(new Map(), 9), readsUnit("", 5), readsUnit("abc", 2), readsUnit("abc", 3)].join());
report("end");
