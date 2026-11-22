// answers: with-library
// # `view.setUint8(i, rows[i])` where rows comes from outside (JSON.parse): the turn runs other code, so no guess can leave it, the read of the method stayed a look-up and the call went through the host's function.
// # The accessors of 8, 16 and 32 bits and of both floats have a boxed stub: the read is left unread, and the stub of the call looks at the receiver and does the access. It goes to the host's function unless the offset
// # is an int32 that is not negative, the value an int32 (a number for floats), the order, where given, a boolean, the length fixed, and offset + size within it.
// # RUN(STUBS): bytes mechanisms=all
// # REQUIRES(STUBS): as-written
// # STUBS: CallMethodThatMayBeUnread.DataViewSetUint8
// # Every width with values, orders and offsets of every kind from outside; the bound of each width and one beyond; NaNs with a payload written as bytes and read as floats, then used; subclasses, other receivers,
// # detached and resized buffers, too few and too many arguments. At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 178 of 178 of 178
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;

const outside = JSON.parse('{"rows":[3,1,250,256,-1,-129,32768,65535,65536,2147483647,-2147483648,4294967295,1.5,-1.5,1e10,-0.0],"at":[0,1,2,3,5,8,13,21]}');
const view = new DataView(new ArrayBuffer(64));
function attempt(run: () => unknown) { try { return run(); } catch (error) { return (error as Error).name; } }
function hex(from: DataView, begin: number, end: number) { let s = ""; for (let i = begin; i < end; i++) s += (from.getUint8(i) + 256).toString(16).slice(1); return s; }
function storesRow(into: any, row: any, little: any) { into.setInt8(0, row); into.setUint8(1, row); into.setInt16(2, row, little); into.setUint16(4, row, little); into.setInt32(8, row, little); into.setUint32(12, row, little); into.setFloat32(16, row, little); into.setFloat64(24, row, little); }
function storesRowInGivenOrder(into: any, row: any) { into.setInt16(2, row); into.setUint16(4, row); into.setInt32(8, row); into.setUint32(12, row); into.setFloat32(16, row); into.setFloat64(24, row); }
function readsAt(from: any, at: any, little: any) { return [from.getInt8(at), from.getUint8(at), from.getInt16(at, little), from.getUint16(at, little), from.getInt32(at, little), from.getUint32(at, little), from.getFloat32(at, little), from.getFloat64(at, little)].join(); }
function readsAtInGivenOrder(from: any, at: any) { return [from.getInt16(at), from.getUint16(at), from.getInt32(at), from.getUint32(at), from.getFloat32(at), from.getFloat64(at)].join(); }
function storesRows(rows: any) { for (let i = 0; i < rows.length; i++) view.setUint8(i, rows[i]); return hex(view, 0, rows.length); }
function storesWords(rows: any, little: any) { for (let i = 0; i < rows.length; i++) view.setUint32(i * 4, rows[i], little); return hex(view, 0, rows.length * 4); }

report(storesRows(outside.rows)); report(storesWords(outside.rows, true)); report(storesWords(outside.rows, false));
for (const row of outside.rows) for (const little of [true, false]) { storesRow(view, row, little); report(hex(view, 0, 32) + " " + readsAt(view, 8, little) + " " + readsAt(view, 16, !little)); }
for (const row of outside.rows) { storesRowInGivenOrder(view, row); report(hex(view, 0, 32) + " " + readsAtInGivenOrder(view, 24)); }
for (let i = 0; i < 64; i++) view.setUint8(i, (i * 37 + 11) & 255);
for (const at of outside.at) report(readsAt(view, at, true) + " " + readsAt(view, at, false) + " " + readsAtInGivenOrder(view, at));
for (const little of [undefined, null, 0, 1, "", "x", {}, NaN, -0, 0n, 1n, Symbol.iterator]) report(attempt(() => { storesRow(view, 258, little); return hex(view, 0, 32) + " " + readsAt(view, 2, little); }));
for (const value of [2 ** 31, 2 ** 32 + 5, -(2 ** 31) - 1, NaN, Infinity, -Infinity, -0, "7", "x", "", null, undefined, true, false, [], [5], {}, { valueOf() { return 9; } }, 10n, Symbol.iterator]) report(attempt(() => { storesRow(view, value, true); return hex(view, 0, 32); }));
const accessors: [string, number][] = [["Int8", 1], ["Uint8", 1], ["Int16", 2], ["Uint16", 2], ["Int32", 4], ["Uint32", 4], ["Float32", 4], ["Float64", 8]];
function getsInt8(from: any, at: any) { return from.getInt8(at); }
function getsUint8(from: any, at: any) { return from.getUint8(at); }
function getsInt16(from: any, at: any) { return from.getInt16(at, true); }
function getsUint16(from: any, at: any) { return from.getUint16(at, true); }
function getsInt32(from: any, at: any) { return from.getInt32(at, true); }
function getsUint32(from: any, at: any) { return from.getUint32(at, true); }
function getsFloat32(from: any, at: any) { return from.getFloat32(at, true); }
function getsFloat64(from: any, at: any) { return from.getFloat64(at, true); }
function setsInt8(into: any, at: any) { return into.setInt8(at, 1); }
function setsUint8(into: any, at: any) { return into.setUint8(at, 1); }
function setsInt16(into: any, at: any) { return into.setInt16(at, 1, true); }
function setsUint16(into: any, at: any) { return into.setUint16(at, 1, true); }
function setsInt32(into: any, at: any) { return into.setInt32(at, 1, true); }
function setsUint32(into: any, at: any) { return into.setUint32(at, 1, true); }
function setsFloat32(into: any, at: any) { return into.setFloat32(at, 1, true); }
function setsFloat64(into: any, at: any) { return into.setFloat64(at, 1, true); }
const gets = [getsInt8, getsUint8, getsInt16, getsUint16, getsInt32, getsUint32, getsFloat32, getsFloat64], sets = [setsInt8, setsUint8, setsInt16, setsUint16, setsInt32, setsUint32, setsFloat32, setsFloat64];
for (let i = 0; i < 64; i++) view.setUint8(i, (i * 37 + 11) & 255);
for (let k = 0; k < 8; k++) report(accessors[k][0] + ": " + [64 - accessors[k][1], 65 - accessors[k][1], 63, 64, -1, -0, 0.5, 1.5, -0.5, 2 ** 31, 2 ** 31 - 1, 2 ** 32, 2 ** 32 - 1, 2 ** 53, NaN, Infinity, undefined, null, "3", "x", { valueOf() { return 2; } }].map(at => String(attempt(() => gets[k](view, at))) + "|" + String(attempt(() => sets[k](view, at)))).join());
report(hex(view, 0, 64));

const patterns = [[255, 255, 255, 255, 255, 255, 255, 255], [255, 254, 0, 0, 0, 0, 0, 1], [255, 255, 0, 0, 0, 0, 0, 7], [127, 248, 0, 0, 0, 0, 0, 1], [127, 240, 0, 0, 0, 0, 0, 1], [255, 248, 0, 0, 18, 52, 86, 120], [255, 240, 0, 0, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 10], [127, 192, 0, 1, 127, 128, 0, 1]];
function uses(value: any) { const held = [value, { value }]; return typeof value + " " + String(value) + " " + String(value + 1) + " " + Object.is(value, NaN) + " " + JSON.stringify(held) + " " + String(held[0] === held[0]) + " " + String((held[1] as any).value); }
for (const pattern of patterns) for (const little of [true, false]) { for (let i = 0; i < 8; i++) view.setUint8(i, pattern[i]); report(uses(getsFloat64(view, 0)) + " ; " + uses(view.getFloat64(outside.at[0], little)) + " ; " + uses(view.getFloat32(outside.at[0], little)) + " ; " + uses(view.getFloat32(outside.at[3] + 1, little))); }
for (const pattern of patterns) { for (let i = 0; i < 8; i++) view.setUint8(i, pattern[i]); const read = view.getFloat64(outside.at[0], false); view.setFloat64(outside.at[5], read, false); view.setFloat32(outside.at[5] + 8, view.getFloat32(outside.at[0], false), false); report(Number.isNaN(read) ? "NaN" : hex(view, 8, 20)); }

class Plain extends DataView<ArrayBuffer> {}
class Wide extends DataView<ArrayBuffer> { getUint8(at: number) { return 1000 + super.getUint8(at); } setUint8(at: number, value: number) { super.setUint8(at, value + 1); } }
const detachedBuffer = new ArrayBuffer(16), resizable = new ArrayBuffer(16, { maxByteLength: 32 });
const receivers: any[] = [view, new Plain(new ArrayBuffer(16)), new Wide(new ArrayBuffer(16)), new DataView(new ArrayBuffer(16), 4, 8), new DataView(detachedBuffer), new DataView(resizable), new DataView(resizable, 4, 8), new DataView(resizable, 4), { getUint8: () => "mine", setUint8: () => "mine too", getUint32: () => "mine" }, new Uint8Array(16), null, 5, "text"];
function visits(round: string) { for (const receiver of receivers) report(round + " " + [0, 7, 8, 11, 12, 15, 16].map(at => String(attempt(() => setsUint8(receiver, at))) + "|" + String(attempt(() => getsUint8(receiver, at))) + "|" + String(attempt(() => getsUint32(receiver, at)))).join()); }
visits("as made"); detachedBuffer.transfer(); resizable.resize(8); visits("shorter"); resizable.resize(32); visits("longer");
for (const receiver of [{}, new Uint8Array(4), null, undefined, 5, new ArrayBuffer(8)]) report(String(attempt(() => DataView.prototype.getUint8.call(receiver as any, 0))) + " " + String(attempt(() => DataView.prototype.setFloat64.call(receiver as any, 0, 1))));
const any: any = view;
report([attempt(() => any.getUint8()), attempt(() => any.getUint8(0, true, 5)), attempt(() => any.getUint16()), attempt(() => any.getUint16(0, true, 5)), attempt(() => any.setUint8()), attempt(() => any.setUint8(0)), attempt(() => any.setUint8(0, 1, true)), attempt(() => any.setUint16(0)), attempt(() => any.setUint16(0, 1, true, 5)), attempt(() => any.setFloat64(0))].join()); report(hex(view, 0, 16));
report("end");
