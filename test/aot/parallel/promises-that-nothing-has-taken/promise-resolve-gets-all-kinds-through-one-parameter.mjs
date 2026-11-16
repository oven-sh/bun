// Promise.resolve gets a number, a thenable, a promise and a promise of a class below through one parameter
const log = [];
class Mine extends Promise { }
function wrap(value) {
    return Promise.resolve(value);
}
function deed(kind) {
    if (kind === 0)
        return 1;
    if (kind === 1)
        return { then(resolve) { log.push("then runs"); resolve("from then"); } };
    if (kind === 2)
        return Promise.resolve("a promise");
    return Mine.resolve("of a class below");
}
for (let kind = 0; kind < 4; kind++) {
    const value = deed(kind);
    const made = wrap(value);
    log.push(kind + " " + (made instanceof Promise) + " " + (made === value) + " " + (made instanceof Mine));
    log.push(String(await made));
}
console.log(log.join("\n"));
