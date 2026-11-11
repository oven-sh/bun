"use strict";
// The closure is called in the inner turn.
const rows = JSON.parse('[[0,1,2,3],[1,1,0],[2,5,7,8,9]]'), parts = JSON.parse('[0.5, 7, "q", null, 1e10]');
function run(c, part, when) {
    const pair = [1, 2];
    const lay = v => { pair[1] = v; };
    let sum = "";
    for (let r = 0; r < 4; r++) {
        for (const x of c) { if (x === when) lay(part); sum += pair[x & 1] + ","; }
        
    }
    return sum + pair.length;
}
const ops = { run, idle() { return ""; } }, steps = JSON.parse('["run"]');
const printed = [];
for (let turn = 0; turn < 15; turn++) printed.push(ops[steps[0]](rows[turn % 3], parts[turn % 5], turn % 4));
console.log(printed.join(" "));
