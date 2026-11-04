// a getter `then` that throws is defined on a record that a loop awaits
const log = [];
async function wait(record, turns) {
    let caught = 0;
    for (let i = 0; i < turns; i++) {
        try {
            const held = await record;
            log.push("turn " + i + " " + (held === record));
        } catch (error) {
            caught++;
            log.push("turn " + i + " caught " + error);
        }
    }
    return caught;
}
function deed(record) {
    let reads = 0;
    Object.defineProperty(record, "then", { configurable: true, get() { throw "read " + ++reads; } });
}
log.push(String(await wait({ x: 1 }, 2)));
const record = { x: 2 };
const waiting = wait(record, 4);
await null;
deed(record);
log.push(String(await waiting));
console.log(log.join("\n"));
