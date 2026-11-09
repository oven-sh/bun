// a `then` of its own is stored on what Promise.resolve has just made, in front of its await
const log = [];
async function plain(turns) {
    let sum = 0;
    for (let i = 0; i < turns; i++)
        sum += await Promise.resolve(i);
    return sum;
}
async function deed(i) {
    const made = Promise.resolve(i);
    made.then = resolve => { log.push("then of its own " + i); resolve("own"); };
    return await made;
}
log.push(String(await plain(4)));
log.push(String(await deed(1)));
for (let i = 2; i < 5; i++)
    log.push(String(await deed(i)));
log.push(String(await plain(3)));
console.log(log.join("\n"));
