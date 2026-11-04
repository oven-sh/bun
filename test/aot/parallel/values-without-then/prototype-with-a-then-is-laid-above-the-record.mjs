// an object with a `then` is laid above a record that a loop awaits
const log = [];
async function wait(record, turns) {
    let last;
    for (let i = 0; i < turns; i++) {
        last = await record;
        log.push("turn " + i + " " + (last === record ? "the record" : String(last)));
    }
    return last;
}
function deed(record) {
    Object.setPrototypeOf(record, {
        then(resolve) {
            log.push("then from above, x is " + this.x);
            Object.setPrototypeOf(this, Object.prototype);
            resolve("from above");
        },
    });
}
const cold = { x: 1 };
log.push(String((await wait(cold, 2)) === cold));
const record = { x: 2 };
const waiting = wait(record, 4);
await null;
deed(record);
log.push(String((await waiting) === record));
console.log(log.join("\n"));
