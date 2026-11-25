// Object.groupBy gets a list with a getter under Symbol.iterator, which counts how often it is read
const log = [];
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
function deed(items) {
    let reads = 0;
    Object.defineProperty(items, Symbol.iterator, { get() { reads++; return Array.prototype.values; } });
    return () => reads;
}
log.push(group([1, 2, 3, 4]));
for (let i = 0; i < 3; i++)
    log.push(group([i, i + 1, i + 2]));
const items = [5, 6, 7];
const reads = deed(items);
log.push(group(items) + " reads " + reads());
log.push(group([8, 9]));
console.log(log.join("\n"));
