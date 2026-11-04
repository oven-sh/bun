// a `then` is stored on a record under a key that is put together at run time
const log = [];
async function wait(record, turns) {
    let last;
    for (let i = 0; i < turns; i++) {
        last = await record;
        log.push("turn " + i + " " + (last === record ? "the record" : String(last)));
    }
    return last;
}
function deed(record, key) {
    record[key] = resolve => {
        log.push("then runs");
        delete record[key];
        resolve("from then");
    };
}
const cold = { x: 1 };
log.push(String((await wait(cold, 2)) === cold));
const record = { x: 2 };
const waiting = wait(record, 4);
await null;
deed(record, ["th", "en"].join(""));
log.push(String((await waiting) === record));
console.log(log.join("\n"));
