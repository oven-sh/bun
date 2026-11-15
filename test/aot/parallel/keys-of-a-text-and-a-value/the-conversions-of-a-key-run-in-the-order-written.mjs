const log = [];
const says = (name, answer) => ({ valueOf() { log.push(name); return answer; } });
function key(table, a, b, c) { const name = a + ":" + b + "/" + c; table[name] ??= []; table[name].push(log.length); return name; }
const table = {};
for (let turn = 0; turn < 30; turn++) key(table, says("a", turn % 2), says("b", "x"), says("c", null));
console.log(JSON.stringify(Object.keys(table)), log.length, log.slice(0, 9).join(""));
log.length = 0;
for (const [a, b, c] of [[says("a", 1), says("b", 2), Symbol("third")], [says("a", 1), says("b", 2), says("c", Symbol("given"))]]) {
    try { key(table, a, b, c); console.log("no throw"); } catch (error) { console.log(error.constructor.name, log.join("")); }
    log.length = 0;
}
function kept(table, value) { const name = value + ":"; table[name] = 1; return [typeof value, value]; }
console.log(JSON.stringify([kept({}, 5), kept({}, "s"), kept({}, null), kept({}, [1])]));
function numbers(table, a, b) { const name = a + b; table[name] = (table[name] ?? 0) + 1; return name; }
const sums = {};
for (let turn = 0; turn < 30; turn++) { numbers(sums, turn % 3, 1); numbers(sums, "t", turn % 2); numbers(sums, turn % 2, "t"); numbers(sums, 1n, 2n); numbers(sums, null, 1); numbers(sums, undefined, 1); numbers(sums, [], {}); }
console.log(JSON.stringify(sums));
