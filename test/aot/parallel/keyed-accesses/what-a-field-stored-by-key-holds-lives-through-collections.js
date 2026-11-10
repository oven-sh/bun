// A holder that has grown old is given young values by key, in a field that it was written with: the collector must hear of each store.
const names = ["open", "shut", "turn", "rest"];
function lay(holder, name, value) { "use strict"; holder[name] = value; }
const holders = [];
for (let index = 0; index < 50; index++) holders.push({ open: undefined, shut: undefined, turn: undefined, rest: undefined });
for (let round = 0; round < 30; round++) {
    for (const holder of holders) {
        for (const name of names) lay(holder, name, round);
    }
}
Bun.gc(true);
Bun.gc(true);
let sum = 0;
for (let round = 0; round < 40; round++) {
    for (let index = 0; index < holders.length; index++) {
        for (const name of names) lay(holders[index], name, { round, index, name, list: [round, index] });
    }
    const litter = [];
    for (let index = 0; index < 20000; index++) litter.push({ index, text: "t" + index });
    if (round % 4 === 0) Bun.gc(true);
    for (let index = 0; index < holders.length; index++) {
        for (const name of names) {
            const held = holders[index][name];
            if (held.round !== round || held.index !== index || held.name !== name || held.list[0] !== round || held.list[1] !== index) throw new Error("lost " + round + " " + index + " " + name);
            sum += held.list[1] + litter.length;
        }
    }
}
console.log("held", sum);
