// a `constructor` of its own is stored on what Promise.resolve has just made: its await and a second Promise.resolve make a new promise
const log = [];
async function ticks(turns) {
    for (let i = 0; i < turns; i++) {
        log.push("tick " + i);
        await undefined;
    }
}
async function plain(name) {
    const made = Promise.resolve(name);
    log.push(name + " same " + (Promise.resolve(made) === made));
    log.push("awaited " + (await made));
}
async function deed(name) {
    const made = Promise.resolve(name);
    made.constructor = function Other() { };
    log.push(name + " same " + (Promise.resolve(made) === made));
    log.push("awaited " + (await made));
}
const ticking = ticks(6);
const all = [plain("a"), deed("b"), plain("c")];
for (let i = 0; i < all.length; i++)
    await all[i];
await ticking;
console.log(log.join("\n"));
