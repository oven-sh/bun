"use strict";
// STATISTIC: TypedArraySubclassLoopsVersioned >= 2
// A Buffer and a Uint8Array run the same walked loop: where no turn calls anything they share one copy, as under a written `Uint8Array`. Where a turn calls, each keeps its own: what is known of the names below a class does not outlive other code.
const key = JSON.parse('"go"');
const hashed = { go(d) { let h = 7; for (let i = 0; i <= d.length; i++) h = (h * 31 + d[i]) | 0; return h; } };
const stored = { go(d) { for (let i = 0; i < d.length; i++) d[i] = (d[i] ^ 90) + 1; let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; return s; } };
const calls = { go(d) { const o = []; for (let i = 0; i < d.length; i++) o.push(d[i] & 15); return o.join(""); } };
class Heir extends Uint8Array { get length() { return 2; } }
class Plain extends Uint8Array {}
class Below extends Buffer {}
const named = Buffer.from([1, 2, 3]); Object.defineProperty(named, "length", { value: 1 });
const indexed = new Uint8Array([1, 2, 3]); indexed.extra = 9;
const elsewhere = new Uint8Array([4, 5]); Object.setPrototypeOf(elsewhere, Buffer.prototype);
const bare = Buffer.from([6, 7]); Object.setPrototypeOf(bare, Uint8Array.prototype);
const nothing = Buffer.from([8]); Object.setPrototypeOf(nothing, null);
const grows = new Uint8Array(new ArrayBuffer(2, { maxByteLength: 8 }));
const gone = new Uint8Array(4); structuredClone(gone.buffer, { transfer: [gone.buffer] });
const given = () => [Buffer.from([1, 255, 0]), new Uint8Array([1, 255, 0]), Buffer.alloc(0), new Uint8Array(0), Buffer.from("héllo"), Buffer.from([9, 8, 7, 6]).subarray(1, 3), new Uint8Array([9, 8, 7, 6]).subarray(1), new Heir([1, 2, 3]), new Plain([1, 2, 3]), Below.from([1, 2]), named, indexed, elsewhere, bare, nothing, grows, gone, new Uint8ClampedArray([300, -1]), new Int8Array([-1]), [1, 2], "12"];
for (const table of [hashed, stored, calls]) for (const d of given()) for (let turn = 0; turn < 3; turn++) { let said; try { said = String(table[key](d)); } catch (e) { said = e.name; } console.log(said); }
