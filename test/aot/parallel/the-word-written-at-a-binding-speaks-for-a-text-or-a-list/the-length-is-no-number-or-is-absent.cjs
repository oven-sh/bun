'use strict';
const given = JSON.parse('[{"length":"2","0":"a","1":"a"},{"0":"a"},"aa",["b","b"],7,true,"iterator"]');
let reads = 0;
given.push({ get length() { reads++; return 2; }, 0: 'p', 1: 'q' });
function mirrored() {
  let said = '';
  for (const held of given) {
    let i = 0, j = held.length - 1;
    while (i < j && held[i] === held[j]) { i++; j--; }
    said += (i >= j ? 'y' : 'n') + String(j);
  }
  return said;
}
globalThis.kept = mirrored;
for (let turn = 0; turn < 3; turn++) console.log(mirrored(), reads);
try {
  given.push(null);
  mirrored();
} catch (error) {
  console.log(error instanceof TypeError, reads);
}
