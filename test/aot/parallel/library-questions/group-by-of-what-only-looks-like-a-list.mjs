// Object.groupBy gets an instance of a class below Array with an iterator of its own, a list below another prototype, a Set and a text, where lists arrive most often
const log = [];
class Doubled extends Array {
    *[Symbol.iterator]() {
        for (let i = 0; i < this.length; i++)
            yield this[i] * 2 + 1;
    }
}
function keyOf(value) {
    return value % 2 ? "odd" : "even";
}
function group(items) {
    const groups = Object.groupBy(items, keyOf);
    let text = "";
    for (const key in groups)
        text += key + ":" + groups[key].join() + ";";
    return text;
}
function deed(kind) {
    if (kind === 0)
        return Doubled.of(1, 2, 3);
    if (kind === 1)
        return Object.setPrototypeOf([1, 2, 3], { *[Symbol.iterator]() { yield 40; } });
    if (kind === 2)
        return new Set([1, 2, 2, 3]);
    return "123";
}
log.push(group([1, 2, 3, 4]));
for (let kind = 0; kind < 4; kind++)
    log.push(group(deed(kind)));
log.push(group([5, 6]));
console.log(log.join("\n"));
