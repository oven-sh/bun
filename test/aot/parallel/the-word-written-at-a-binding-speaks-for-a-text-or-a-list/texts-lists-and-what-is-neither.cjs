'use strict';
const given = JSON.parse('["level",["a",7,"a"],"ab",[1,2],[],"",{"length":3,"0":"q","1":"r","2":"q"},{"length":2,"0":1,"1":2},[null,null],["x",[1],"x"]]');
given.push(new Uint8Array([5, 6, 5]), new String('noon'), Object.assign(['a', 'b'], { length: 1 }));
function mirrored(from) {
  let said = '';
  for (const held of given) {
    let i = 0, j = held.length - 1;
    while (i < j && held[i] === held[j]) { i++; j--; }
    said += i >= j ? 'y' : 'n';
  }
  return said + from;
}
globalThis.kept = mirrored;
for (let turn = 0; turn < 3; turn++) console.log(mirrored(turn));
