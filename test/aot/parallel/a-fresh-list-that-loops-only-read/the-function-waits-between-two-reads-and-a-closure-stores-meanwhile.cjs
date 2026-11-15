"use strict";
// The function is suspended between the reads; a closure that names the list runs in the meantime.
const values = JSON.parse('[["a",1],["b",2],["c",3],["d",4]]');
const waiting = [];
async function twice(from, key) {
    const held = [from[0], from[1], from[2]];
    waiting.push(() => { held[key] = from[3]; });
    const first = held[key];
    await null;
    const second = held[key];
    return String(first[0]) + String(second[0]);
}
const ops = { twice, idle() { return ""; } }, steps = JSON.parse('["twice"]');
(async () => {
    const printed = [];
    for (let turn = 0; turn < 12; turn++) {
        const answer = ops[steps[0]](values, turn % 3);
        if (turn & 1) waiting.pop()();
        printed.push(await answer);
    }
    console.log(printed.join(" "));
})();
