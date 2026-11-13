// Objects are made in a loop, one in 1,024 is kept, every one is read: in a variable of the module, in a list, in a field, by nobody.
// STATISTIC: AllocationsSunk >= 2
class Reading {
    constructor(at, value) { this.at = at; this.value = value; }
    weight() { return this.at + this.value; }
}

let last = null;
const holder = { last: null };

function keptInVariable(count) {
    let total = 0;
    for (let i = 0; i < count; i++) {
        const reading = new Reading(i & 7, 3);
        if ((i & 1023) === 0)
            last = reading;
        total += reading.weight();
    }
    return total + last.at;
}

function keptInList(count) {
    const kept = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
        const reading = new Reading(i & 7, 3);
        if ((i & 1023) === 0)
            kept.push(reading);
        total += reading.weight();
    }
    return total + kept.length;
}

function keptInField(count) {
    let total = 0;
    for (let i = 0; i < count; i++) {
        const reading = { at: i & 7, value: 3 };
        if ((i & 1023) === 0)
            holder.last = reading;
        total += reading.at + reading.value;
    }
    return total + holder.last.at;
}

function keptByNobody(count) {
    let total = 0;
    for (let i = 0; i < count; i++) {
        const reading = new Reading(i & 7, 3);
        total += reading.weight();
    }
    return total;
}

const forms = { variable: keptInVariable, list: keptInList, field: keptInField, nobody: keptByNobody };
const count = Number(process.env.COUNT ?? "1000");
const form = process.env.FORM;
for (const name of Object.keys(forms)) {
    if (!form || form === name)
        console.log(name, forms[name](count));
}
