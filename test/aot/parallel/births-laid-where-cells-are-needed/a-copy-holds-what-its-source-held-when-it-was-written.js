// A copy is written, its source changes, and one turn in two keeps the copy.
const kept = [];
function copyThenGrow(source, keeps) {
    const copy = [...source];
    source.push(source.length);
    if (keeps)
        kept.push(copy);
    return source.length;
}
function copyFieldsThenChange(source, keeps) {
    const copy = { ...source };
    source.weight = source.weight + 1;
    if (keeps)
        kept.push(copy);
    return source.weight;
}
const list = [0, 1];
const record = { weight: 1 };
const ways = { copyThenGrow, copyFieldsThenChange };
for (const name of Object.keys(ways)) {
    for (let i = 0; i < 8; i++)
        ways[name](name === "copyThenGrow" ? list : record, (i & 1) === 0);
}
console.log(kept.map(copy => Array.isArray(copy) ? copy.length : copy.weight).join(" "));
