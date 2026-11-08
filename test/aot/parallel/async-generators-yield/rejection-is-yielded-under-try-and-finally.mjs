// an async generator yields a rejected promise under try, catch and finally
const log = [];
async function* subject(values) {
    for (let i = 0; i < values.length; i++) {
        try {
            const sent = yield values[i];
            log.push("sent " + sent);
        } catch (error) {
            log.push("caught " + error);
            yield "goes on behind " + error;
        } finally {
            log.push("finally " + i);
        }
    }
    return "over";
}
function deed(n) {
    const rejected = Promise.reject("rejection " + n);
    rejected.catch(() => { });
    return rejected;
}
const made = subject([1, deed(2), { then(resolve, reject) { reject("thenable 3"); } }, 4]);
for (let i = 0; i < 8; i++) {
    const step = await made.next("s" + i);
    log.push((step.done ? "done " : "value ") + step.value);
}
console.log(log.join("\n"));
