// the functions of Promise that make a promise for their receiver are called on Promise and on a class below it
const log = [];
class Mine extends Promise { }
function kindOf(made) {
    return made instanceof Mine ? "Mine" : made instanceof Promise ? "Promise" : typeof made;
}
async function subject(constructor) {
    const capability = constructor.withResolvers();
    capability.resolve(1);
    const tried = constructor.try(() => 2);
    const all = constructor.all([3, constructor.resolve(4)]);
    const raced = constructor.race([5]);
    const then = constructor.resolve(6).then(value => value + 1);
    log.push([capability.promise, tried, all, raced, then].map(kindOf).join());
    log.push([await capability.promise, await tried, (await all).join("+"), await raced, await then].join());
}
function deed() {
    return Mine;
}
await subject(Promise);
await subject(deed());
await subject(Promise);
console.log(log.join("\n"));
