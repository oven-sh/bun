// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk and its proofs as users build, every position tested where it is used: a store that is told inside and is not stops by name.
"use strict";
function fill(v, w) { for (let i = 0; i + 2 < w.length; i += 3) { v[i] = 201; v[i + 1] = 202; v[i + 2] = 203; } }
function own(v) { for (let i = 0; i + 2 < v.length; i += 3) { v[i] = 101; v[i + 1] = 102; v[i + 2] = 103; v[i + 3] = 104; } }
for (const length of [0, 1, 2, 3, 11, 12]) {
  const buffer = new ArrayBuffer(96); const all = new Uint8Array(buffer).fill(7);
  const middle = new Uint8Array(buffer, 32, length);
  own(middle);
  console.log(length, "own", all.subarray(24, 32).join(), "|", middle.join(), "|", all.subarray(32 + length, 48 + length).join());
  all.fill(7); fill(middle, new Uint8Array(20));
  console.log(length, "by another", all.subarray(24, 32).join(), "|", middle.join(), "|", all.subarray(32 + length, 56 + length).join());
}
