// a `then` is stored by name on a record between two awaits of it
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
    record.then = resolve => {
        log.push("then runs");
        delete record.then;
        resolve("from then");
    };
}
const cold = { x: 1 };
log.push(String((await wait(cold, 2)) === cold));
const record = { x: 2 };
const waiting = wait(record, 4);
await null;
deed(record);
log.push(String((await waiting) === record));
console.log(log.join("\n"));
