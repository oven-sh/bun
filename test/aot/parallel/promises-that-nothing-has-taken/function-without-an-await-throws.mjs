// an async function in which nothing suspends throws: at once, out of a finally, and out of what it calls
const log = [];
function fails(what) {
    throw new RangeError(what);
}
async function atOnce(n) {
    if (n > 1)
        throw "thrown " + n;
    return n;
}
async function throughFinally(n) {
    try {
        if (n > 1)
            fails("through " + n);
        return n;
    } finally {
        log.push("finally " + n);
    }
}
function deed(subject, n) {
    let made;
    try {
        made = subject(n);
        log.push("the call returns " + (made instanceof Promise));
    } catch (error) {
        log.push("the call throws " + error);
        return Promise.resolve("nothing");
    }
    return made.then(value => "gives " + value, error => "fails " + (error instanceof Error ? error.name + " " + error.message : error));
}
for (let n = 0; n < 4; n++) {
    log.push(await deed(atOnce, n));
    log.push(await deed(throughFinally, n));
}
console.log(log.join("\n"));
