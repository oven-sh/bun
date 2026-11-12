// answers: with-library
// # `view.setUint8(i, source.getUint8(i))`: the method is read, then the arguments are made, then it is called. The call in the arguments may run other code, so the stretch of the guess "the view is as made" ended in front of
// # the call, the read of the method stayed a look-up by name, the call went through the host's function, and the loop was not built twice. The callee is bound at the read, whatever the arguments run: where the
// # guess can leave for the closed copy, what stands in front of the call of one built-in function does not end the stretch, as it does not where the method found is a closure; and the purchase of the second build
// # counts on that guess.
// # f55 = copiesCaptured, f56 = storesCaptured: the views and the list are variables of the function around, as in a CommonJS file.
// # RUN(FORM): walk f55 f56 mechanisms=all
// # REQUIRES(FORM): as-written
// # FORM-LABEL: f55
// # FORM: = GetDataViewLimit
// # FORM: PutDataViewElement
// # FORM-LABEL: f56
// # FORM: = GetDataViewLimit
// # FORM: PutDataViewElement
// # What the making of an argument does between the read and the call: (a list whose own prototype has a getter under an index) it detaches the buffer, makes it shorter, gives the receiver a method of its own, gives it another prototype; holes; a receiver that is
// # nothing, whose arguments are not made; receivers in turn; the same form on a map, a set, a list, a text and a view. At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 112 of 112 of 112
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;

const view = new DataView(new ArrayBuffer(64));
const rows = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3];
function storesRows() { for (let i = 0; i < 16; i++) view.setUint8(i, rows[i]); }
function sums(from: DataView, turns: number) { let s = 0; for (let i = 0; i < turns; i++) s = (s * 3 + from.getUint8(i)) % 1000003; return s; }
function readsByRows() { let s = 0; for (let i = 0; i < 16; i++) s = (s * 5 + view.getUint8(rows[i])) % 1000003; return s; }
function storesWords(little: boolean) { for (let i = 0; i < 8; i++) view.setUint32(rows[i] * 4, rows[i + 8] * 65537, little); return sums(view, 64); }
function storesThrough(list: number[], into: DataView) { let i = 0; try { for (; i < list.length; i++) into.setUint8(i, list[i]); } catch (error) { return (error as Error).name + " at " + i; } return "all " + i; }

storesRows(); report(sums(view, 16)); report(readsByRows()); report(storesWords(true)); report(storesWords(false));
rows[3] = 300; rows[4] = -1; rows[5] = 2.9; storesRows(); report(sums(view, 16));
rows[3] = 1; rows[4] = 5; rows[5] = 9;

const holed = [1, , 3, , 5, , 7] as number[];
const plain = new DataView(new ArrayBuffer(16));
for (let i = 0; i < 16; i++) plain.setUint8(i, 255);
report(storesThrough(holed, plain)); report(sums(plain, 16));

const said: string[] = [];
function holedAbove(index: number, does: () => number) { const list = [1, , 3, , 5, , 7] as number[]; Object.setPrototypeOf(list, Object.create(Array.prototype, { [index]: { get: does } })); return list; }
const detachedBuffer = new ArrayBuffer(16), overDetached = new DataView(detachedBuffer);
report(storesThrough(holedAbove(3, () => { detachedBuffer.transfer(); return 9; }), overDetached));
report(storesThrough(holed, overDetached));

const shorter = new ArrayBuffer(16, { maxByteLength: 32 }), tracks = new DataView(shorter);
report(storesThrough(holedAbove(5, () => { shorter.resize(4); return 9; }), tracks));
report(tracks.byteLength); shorter.resize(16); report(storesThrough(holed, tracks)); report(sums(tracks, 16));

const gainsItsOwn = new DataView(new ArrayBuffer(16));
report(storesThrough(holedAbove(1, () => { Object.defineProperty(gainsItsOwn, "setUint8", { value(at: number, what: number) { said.push("own " + at + " " + what); }, configurable: true }); return 41; }), gainsItsOwn));
report(said.join()); report(sums(gainsItsOwn, 8)); said.length = 0;
delete (gainsItsOwn as any).setUint8; report(storesThrough(holed, gainsItsOwn)); report(said.join()); report(sums(gainsItsOwn, 8));

const getsAnotherPrototype = new DataView(new ArrayBuffer(16));
report(storesThrough(holedAbove(3, () => { Object.setPrototypeOf(getsAnotherPrototype, { setUint8(at: number, what: number) { said.push("above " + at + " " + what); } }); return 42; }), getsAnotherPrototype));
report(said.join()); said.length = 0;
Object.setPrototypeOf(getsAnotherPrototype, DataView.prototype); report(sums(getsAnotherPrototype, 8));

function storesIntoOneOf(receivers: (DataView | null)[], list: number[]) { let i = 0; try { for (; i < list.length; i++) receivers[i % receivers.length]!.setUint8(i, (said.push("made " + i), list[i])); } catch (error) { return (error as Error).name + " at " + i; } return "all " + i; }
const first = new DataView(new ArrayBuffer(16)), second = new DataView(new ArrayBuffer(16));
report(storesIntoOneOf([first, second], rows)); report(sums(first, 16)); report(sums(second, 16)); report(said.length); said.length = 0;
report(storesIntoOneOf([first, second, null], rows)); report(said.join()); said.length = 0;

const boxes = rows.map(row => ({ valueOf() { said.push("asked " + row); return row; } }));
function storesBoxes(into: DataView) { for (let i = 0; i < 4; i++) into.setUint8(i, boxes[i] as unknown as number); return sums(into, 4); }
report(storesBoxes(first)); report(said.join()); said.length = 0;

const byRow = new Map<number, string>(), seen = new Set<number>(), grown: number[] = [], text = "the quick brown fox", bytes = new Uint8Array(16);
for (let i = 0; i < 16; i++) { byRow.set(rows[i], "r" + i); if (i & 1) seen.add(rows[i]); }
function asksMap() { let s = ""; for (let i = 0; i < 16; i++) s += byRow.get(rows[i]); return s; }
function asksSet() { let s = 0; for (let i = 0; i < 16; i++) s = s * 2 + (seen.has(rows[i]) ? 1 : 0); return s; }
function grows() { for (let i = 0; i < 16; i++) grown.push(rows[i]); return grown.join(""); }
function readsText() { let s = 0; for (let i = 0; i < 16; i++) s = (s * 7 + text.charCodeAt(rows[i])) % 1000003; return s; }
function fillsBytes() { for (let i = 0; i < 16; i++) bytes.fill(rows[i], i, i + 1); return bytes.join(""); }
report(asksMap()); report(asksSet()); report(grows()); report(readsText()); report(fillsBytes());
function asksThrough(list: number[], table: Map<number, string>) { let s = ""; for (let i = 0; i < list.length; i++) s += table.get(list[i]) + ";"; return s; }
report(asksThrough(holed, byRow));
report(asksThrough(holedAbove(3, () => { Object.defineProperty(byRow, "get", { value: (key: number) => "own " + key, configurable: true }); return 5; }), byRow));
delete (byRow as any).get; report(asksThrough(holed, byRow));
const source = new DataView(new ArrayBuffer(64)), octets = new Uint8Array(64);
for (let i = 0; i < 64; i++) { source.setUint8(i, (i * 37 + 11) & 255); octets[i] = (i * 29 + 5) & 255; }
function copies() { for (let i = 0; i < 16; i++) view.setUint8(i, source.getUint8(i)); }
function copiesOctets() { for (let i = 0; i < 16; i++) view.setUint8(i, octets[i]); }
function turnsWords() { for (let i = 0; i < 8; i++) view.setUint32(i * 4, source.getUint32(i * 4, true), false); }
function movesWithin() { for (let i = 0; i < 16; i++) view.setUint8(i, view.getUint8(i + 16)); }
function copiesTwice() { for (let i = 0; i < 16; i++) { view.setUint8(i, source.getUint8(i + 1)); view.setUint8(i + 16, source.getUint8(i + 2)); } }
copies(); report(sums(view, 64)); copiesOctets(); report(sums(view, 64)); turnsWords(); report(sums(view, 64)); movesWithin(); report(sums(view, 64)); copiesTwice(); report(sums(view, 64));
function copiesThrough(from: DataView, into: DataView) { let i = 0; try { for (; i < 8; i++) into.setUint8(i, from.getUint8(i)); } catch (error) { return (error as Error).name + " at " + i; } return "all " + i; }
function doing(at: number, does: () => void) { const from = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) from.setUint8(i, i + 1); Object.defineProperty(from, "getUint8", { value(this: DataView, i: number) { if (i === at) does(); return DataView.prototype.getUint8.call(this, i); } }); return from; }
const target = new DataView(new ArrayBuffer(8));
report(copiesThrough(source, target)); report(sums(target, 8)); report(copiesThrough(doing(9, () => {}), target)); report(sums(target, 8));
const leaves = new ArrayBuffer(8), overLeaving = new DataView(leaves);
report(copiesThrough(doing(3, () => { leaves.transfer(); }), overLeaving)); report(copiesThrough(source, overLeaving));
const shrinks = new ArrayBuffer(8, { maxByteLength: 16 }), overShrinking = new DataView(shrinks);
report(copiesThrough(doing(5, () => { shrinks.resize(2); }), overShrinking)); report(overShrinking.byteLength); shrinks.resize(8); report(copiesThrough(source, overShrinking)); report(sums(overShrinking, 8));
const takesItsOwn = new DataView(new ArrayBuffer(8));
report(copiesThrough(doing(1, () => { Object.defineProperty(takesItsOwn, "setUint8", { value(at: number, what: number) { said.push("own " + at + " " + what); }, configurable: true }); }), takesItsOwn)); report(said.join()); said.length = 0; report(sums(takesItsOwn, 8));
delete (takesItsOwn as any).setUint8; report(copiesThrough(source, takesItsOwn)); report(said.length); report(sums(takesItsOwn, 8));
const isMovedBelow = new DataView(new ArrayBuffer(8));
report(copiesThrough(doing(3, () => { Object.setPrototypeOf(isMovedBelow, { setUint8(at: number, what: number) { said.push("above " + at + " " + what); } }); }), isMovedBelow)); report(said.join()); said.length = 0;
Object.setPrototypeOf(isMovedBelow, DataView.prototype); report(sums(isMovedBelow, 8)); report(copiesThrough(source, isMovedBelow)); report(sums(isMovedBelow, 8));
const captured = (() => { const into = new DataView(new ArrayBuffer(64)), from = new DataView(new ArrayBuffer(64)), list: number[] = []; for (let i = 0; i < 64; i++) { from.setUint8(i, (i * 41 + 3) & 255); list.push((i * 73 + 41) % 256); } function copiesCaptured() { for (let i = 0; i < 16; i++) into.setUint8(i, from.getUint8(i)); return sums(into, 16); } function storesCaptured() { for (let i = 0; i < 16; i++) into.setUint8(i, list[i]); return sums(into, 16); } function turnsCaptured() { for (let i = 0; i < 8; i++) into.setUint32(i * 4, from.getUint32(i * 4, true), false); return sums(into, 32); } return { runs: [copiesCaptured, storesCaptured, turnsCaptured], into, from }; })();
for (const run of captured.runs) report(run());
function attempt(run: () => unknown) { try { return run(); } catch (error) { return (error as Error).name; } }
function does(at: number, what: () => void) { Object.defineProperty(captured.from, "getUint8", { value(this: DataView, i: number) { if (i === at) what(); return DataView.prototype.getUint8.call(this, i); }, configurable: true }); }
does(99, () => {}); report(attempt(captured.runs[0])); delete (captured.from as any).getUint8; report(attempt(captured.runs[0]));
does(1, () => { Object.defineProperty(captured.into, "setUint8", { value(at: number, what: number) { said.push("own " + at + " " + what); }, configurable: true }); }); report(attempt(captured.runs[0])); report(said.join()); said.length = 0;
delete (captured.from as any).getUint8; report(attempt(captured.runs[0])); report(said.join()); said.length = 0; report(attempt(captured.runs[1])); report(said.length); said.length = 0;
delete (captured.into as any).setUint8; report(attempt(captured.runs[0])); report(attempt(captured.runs[1])); report(said.length);
does(3, () => { Object.setPrototypeOf(captured.into, { setUint8(at: number, what: number) { said.push("above " + at + " " + what); }, getUint8: DataView.prototype.getUint8 }); }); report(attempt(captured.runs[0])); report(said.join()); said.length = 0;
delete (captured.from as any).getUint8; report(attempt(captured.runs[1])); report(said.length); said.length = 0; Object.setPrototypeOf(captured.into, DataView.prototype); report(attempt(captured.runs[0])); report(attempt(captured.runs[1])); report(attempt(captured.runs[2]));
does(3, () => { captured.into.buffer.transfer(); }); report(attempt(captured.runs[0])); delete (captured.from as any).getUint8; report(attempt(captured.runs[0])); report(attempt(captured.runs[1])); report(attempt(captured.runs[2]));
function scopeOf(from: DataView, into: DataView) { return function copiesInScope() { let i = 0; try { for (; i < 8; i++) into.setUint8(i, from.getUint8(i)); } catch (error) { return (error as Error).name + " at " + i; } return "all " + i; }; }
const kept = new DataView(new ArrayBuffer(8)); report(scopeOf(source, kept)()); report(sums(kept, 8)); report(scopeOf(doing(9, () => {}), kept)()); report(sums(kept, 8));
const goes = new ArrayBuffer(8), overGoing = new DataView(goes); report(scopeOf(doing(3, () => { goes.transfer(); }), overGoing)()); report(scopeOf(source, overGoing)());
const narrows = new ArrayBuffer(8, { maxByteLength: 16 }), overNarrowing = new DataView(narrows); report(scopeOf(doing(5, () => { narrows.resize(2); }), overNarrowing)()); narrows.resize(8); report(scopeOf(source, overNarrowing)()); report(sums(overNarrowing, 8));
const ownsLater = new DataView(new ArrayBuffer(8)); report(scopeOf(doing(1, () => { Object.defineProperty(ownsLater, "setUint8", { value(at: number, what: number) { said.push("own " + at + " " + what); }, configurable: true }); }), ownsLater)()); report(said.join()); said.length = 0; report(sums(ownsLater, 8));
report(scopeOf(source, ownsLater)()); report(said.join()); said.length = 0; delete (ownsLater as any).setUint8; report(scopeOf(source, ownsLater)()); report(said.length); report(sums(ownsLater, 8));
const sinksLater = new DataView(new ArrayBuffer(8)); report(scopeOf(doing(3, () => { Object.setPrototypeOf(sinksLater, { setUint8(at: number, what: number) { said.push("above " + at + " " + what); } }); }), sinksLater)()); report(said.join()); said.length = 0;
Object.setPrototypeOf(sinksLater, DataView.prototype); report(sums(sinksLater, 8)); report(scopeOf(source, sinksLater)()); report(sums(sinksLater, 8));
report("end");
