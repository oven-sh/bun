"use strict";
// Functions of an untyped file that others may call: what comes is a view where a read by index suggests a list, a list after all, both in turn, a record or nothing, undefined alone and then something, numbers beside undefined.
function sumOfBytes(bytes, from) { let sum = bytes[0] + bytes[1] + bytes[2] + bytes[3]; for (let i = from; i < bytes.length; i++) sum += bytes[i]; return sum; }
function sumOfEither(items) { let sum = items[0] + items[1]; for (let i = 2; i < items.length; i++) sum += items[i]; return sum; }
function firstOf(items) { return items[0] + items[1] + items[2] + items.length; }
function rowsOf(rows, owner, query) { const out = []; for (const row of rows) if (row.owner === owner && (!query || row.size >= query.min)) out.push(row.size); return out.join(); }
function widthOf(box, options) { return box.width + box.margin + box.width * box.margin + (options ? options.scale + options.scale * options.extra : 0); }
function compare(a, b) { return a === undefined ? 1 : b === undefined ? -1 : a - b + (a * b - b * a); }
function lengthOf(text, fallback) { return text ? text.length + text.length * 2 + text.charCodeAt(0) : fallback; }
globalThis.handedOut = { sumOfBytes, sumOfEither, firstOf, rowsOf, widthOf, compare, lengthOf };
const rows = [{ owner: 1, size: 3 }, { owner: 2, size: 5 }, { owner: 1, size: 7 }];
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]), floats = new Float64Array([0.5, 1.5, 2.5, 3.5]), list = [1, 2, 3, 4, 5], holed = [1, , 3, 4];
for (let round = 0; round < 3; round++) {
  console.log(sumOfBytes(bytes, 4), sumOfBytes(bytes, 0), sumOfBytes(Buffer.from([9, 8, 7, 6, 5]), 1));
  console.log(sumOfEither(bytes), sumOfEither(list), sumOfEither(floats), sumOfEither(holed), sumOfEither("abc"), sumOfEither({ 0: 1, 1: 2, 2: 3, length: 3 }));
  console.log(firstOf(floats), firstOf(round ? list : floats), firstOf("xyz"));
  console.log(rowsOf(rows, 1), rowsOf(rows, 2), rowsOf(rows, 3), round === 2 ? rowsOf(rows, 1, { min: 5 }) : "-", round === 2 ? rowsOf(new Set(rows), 1, null) : "-");
  console.log(widthOf({ width: 2, margin: 3 }), widthOf({ width: 2, margin: 3 }, { scale: 2, extra: 5 }), widthOf({ width: 1, margin: 1 }, null), widthOf({ margin: 1, width: 1 }, 0), widthOf({ width: "w", margin: 1 }));
  console.log([3, undefined, 1, 2].sort(compare).join(), compare(1, 2), compare(undefined, 2), compare(2.5, undefined), compare("4", 2));
  console.log(lengthOf("ab", 0), lengthOf("", 7), lengthOf(undefined, 8), lengthOf(null), lengthOf({ length: 2, charCodeAt: () => 5 }, 1));
}
for (const call of [() => sumOfBytes(undefined, 0), () => firstOf(null), () => widthOf(undefined), () => rowsOf(undefined, 1)]) { try { console.log(call()); } catch (error) { console.log(error.constructor.name); } }
