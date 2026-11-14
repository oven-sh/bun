// A number that setInt32 stores is truncated in a terminator, where no operation is generated: the build died.
const view = new DataView(new ArrayBuffer(64));
function fill(n) { let x = 1; for (let i = 0; i < n; i++) { x = x * 1.5 + i; view.setInt32(i * 4, x); view.setUint16(60, x + 0.5, true); } return x; }
function words(list, at) { for (let i = 0; i < list.length; i++) view.setInt8(at + i, list[i] * 3 + 0.25); }
console.log(fill(15), fill(3));
words([1, 2.5, -7, 1e10, NaN], 4);
console.log(Array.from({ length: 16 }, (_, i) => view.getInt32(i * 4)).join());
