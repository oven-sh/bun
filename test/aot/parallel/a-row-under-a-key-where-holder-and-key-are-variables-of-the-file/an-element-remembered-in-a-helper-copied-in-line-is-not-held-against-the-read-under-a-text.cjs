'use strict';
// Where proofs are checked, the row of a copy that was found under a key is held in the turn against the operation that finds an own value of a plain object under a TEXT. An ELEMENT remembered of a list under a counter is
// another thing under the same kind of note: held against that operation it reads "absent", and a right program stopped (names made up).
const given = JSON.parse('["level",["a",7,"a"],"ab",[1,2],[],"",{"length":3,"0":"q","1":"r","2":"q"},{"length":2,"0":1,"1":2},[null,null],["x",[1],"x"]]');
given.push(new Uint8Array([5, 6, 5]), new String('noon'), Object.assign(['a', 'b'], { length: 1 }));
function isMirroredHeld(held) {
    let i = 0, j = held.length - 1;
    while (i < j && held[i] === held[j]) { i++; j--; }
    return i >= j;
}
function mirroredByHelper(from) { let said = ''; for (const held of given) { said += isMirroredHeld(held) ? 'y' : 'n'; } return said + from; }
globalThis.kept = mirroredByHelper;
for (let turn = 0; turn < 3; turn++) console.log("SAID " + mirroredByHelper(turn));
