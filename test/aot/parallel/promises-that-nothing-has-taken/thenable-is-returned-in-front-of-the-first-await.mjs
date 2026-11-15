// a thenable is returned in front of the first await, where a number is returned most often
const log = [];
async function get(hit, waited) {
    if (hit)
        return hit;
    await waited;
    return "late";
}
function deed(name) {
    return { then(resolve) { log.push(name + " then runs"); resolve(name + " from then"); } };
}
async function ticks(turns) {
    for (let i = 0; i < turns; i++) {
        log.push("tick " + i);
        await undefined;
    }
}
const ticking = ticks(6);
for (let i = 1; i <= 3; i++)
    get(i, 0).then(value => log.push("number " + value));
get(deed("a"), 0).then(value => log.push(value));
get(0, 0).then(value => log.push(value));
get(4, 0).then(value => log.push("number " + value));
log.push("behind the calls");
await ticking;
log.push(await get(deed("b"), 0));
console.log(log.join("\n"));
