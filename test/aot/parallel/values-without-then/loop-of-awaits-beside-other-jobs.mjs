// a loop that awaits numbers runs alone, then beside jobs that other promises have queued
const log = [];
async function count(name, turns) {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
        sum += await i;
        log.push(name + " " + sum);
    }
    return sum;
}
function deed(name, turns) {
    let chain = Promise.resolve(0);
    for (let i = 0; i < turns; i++)
        chain = chain.then(value => { log.push(name + " job " + value); return value + 1; });
    return chain;
}
log.push("alone " + (await count("a", 4)));
const both = [count("b", 4), deed("c", 6), count("d", 3)];
queueMicrotask(() => log.push("a job of its own"));
for (let i = 0; i < both.length; i++)
    log.push("gives " + (await both[i]));
console.log(log.join("\n"));
