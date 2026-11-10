// answers: with-library
// # The first read of a method off a built-in prototype is seen, so a call made in line is preceded by InitializeBuiltin: a quick test of a word of the instance and, where it is empty, a stub that makes the cell.
// # Under a key of the kind Value the quick test read the table of values, which only FillBuiltinValue fills, while the stub tests and fills the table of cells: the stub was called at every execution, in every
// # turn of a loop. The word lies in the table of cells whatever the kind of the key: it is filled once and never emptied.
// # f1 = readsBytes
// # RUN(FORM): emit f1 mechanisms=all
// # REQUIRES(FORM): as-written
// # FORM-LABEL: unit f1:Body
// # FORM: = Load({{*}}AOTInstance_fieldsFilledOnce
// # FORM-NOT: = Load({{*}}AllocatorState
// # Every width both ways round, the order of bytes written and in a variable, offsets that are no integers or lie outside, a buffer detached and one made shorter between two turns, an instance with a method of
// # its own. At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 72 of 72 of 72
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;

const view = new DataView(new ArrayBuffer(512));
function readsBytes(t: number) { let s = 0; for (let i = 0; i < 64; i++) s += view.getUint8(i); return s + t; }
function fills(seed: number) { for (let i = 0; i < 512; i++) view.setUint8(i, (i * 37 + seed) & 255); }
function readsWords(little: boolean) { let s = 0; for (let i = 0; i < 64; i++) s = (s + view.getUint32(i * 4, little)) % 1000003; return s; }
function readsWordsWritten() { let s = 0; for (let i = 0; i < 64; i++) s = (s + view.getUint32(i * 4, true) + view.getInt16(i * 2) + view.getInt8(i)) % 1000003; return s; }
function readsNumbers(little: boolean) { let s = 0; for (let i = 0; i < 16; i++) { view.setFloat64(i * 8, i / 3, little); view.setFloat32(256 + i * 4, i / 7, !little); } for (let i = 0; i < 16; i++) s += view.getFloat64(i * 8, little) + view.getFloat32(256 + i * 4, !little); return s; }
function readsBig(little: boolean) { view.setBigInt64(0, -5n, little); view.setBigUint64(8, 2n ** 63n + 9n, little); return String(view.getBigInt64(0, little)) + " " + String(view.getBigUint64(8, little)) + " " + String(view.getBigUint64(0, !little)); }
function copies(rows: number[]) { for (let i = 0; i < rows.length; i++) view.setUint8(i, rows[i]); let s = 0; for (let i = 0; i < rows.length; i++) s = s * 3 + view.getUint8(i); return s; }
function readsAt(from: DataView, offset: any) { try { return from.getUint16(offset, true); } catch (error) { return (error as Error).name; } }
function storesAt(into: DataView, offset: any, value: any) { try { into.setInt16(offset, value); return into.getInt16(offset); } catch (error) { return (error as Error).name; } }
function sumsUntilItThrows(from: DataView, turns: number, between: (i: number) => void) { let s = 0; try { for (let i = 0; i < turns; i++) { s += from.getUint8(i); between(i); } } catch (error) { return (error as Error).name + " behind " + s; } return s; }

fills(1);
report(readsBytes(0)); report(readsBytes(5));
fills(9);
report(readsBytes(0));
for (const little of [true, false]) { report(readsWords(little)); report(readsNumbers(little)); report(readsBig(little)); }
fills(3);
report(readsWordsWritten());
report(copies([1, 2, 3, 250, 256, -1, 1.9, NaN]));
report(copies([, 4, , 5] as number[]));
for (const offset of [0, 1, 1.5, -0, -0.5, -1, NaN, undefined, null, "2", "x", 510, 511, 512, 2 ** 31, 2 ** 32 + 1, Infinity, { valueOf() { return 3; } }]) report(readsAt(view, offset));
for (const offset of [0, 1.5, -1, 511, "4"]) for (const value of [1, 65537, -1.5, "7", undefined]) report(storesAt(view, offset, value));

const detached = new ArrayBuffer(64);
const overDetached = new DataView(detached);
for (let i = 0; i < 64; i++) overDetached.setUint8(i, i);
report(sumsUntilItThrows(overDetached, 64, () => {}));
report(sumsUntilItThrows(overDetached, 64, i => { if (i === 9) detached.transfer(); }));
report(readsAt(overDetached, 0)); report(storesAt(overDetached, 0, 1));

const resizable = new ArrayBuffer(64, { maxByteLength: 128 });
const tracks = new DataView(resizable);
const fixed = new DataView(resizable, 8, 32);
for (let i = 0; i < 64; i++) tracks.setUint8(i, 64 - i);
report(sumsUntilItThrows(tracks, 64, () => {})); report(sumsUntilItThrows(fixed, 32, () => {}));
report(sumsUntilItThrows(tracks, 64, i => { if (i === 19) resizable.resize(24); }));
report(sumsUntilItThrows(fixed, 32, () => {})); report(tracks.byteLength);
resizable.resize(128);
report(sumsUntilItThrows(tracks, 128, () => {})); report(sumsUntilItThrows(fixed, 32, () => {})); report(tracks.byteLength);

const withItsOwn = new DataView(new ArrayBuffer(16));
withItsOwn.setUint8(0, 200);
report(sumsUntilItThrows(withItsOwn, 16, () => {}));
report(sumsUntilItThrows(withItsOwn, 16, i => { if (i === 3) Object.defineProperty(withItsOwn, "getUint8", { value: () => 7, configurable: true }); }));
report(sumsUntilItThrows(withItsOwn, 16, () => {}));
delete (withItsOwn as any).getUint8;
report(sumsUntilItThrows(withItsOwn, 16, () => {}));
report("end");
