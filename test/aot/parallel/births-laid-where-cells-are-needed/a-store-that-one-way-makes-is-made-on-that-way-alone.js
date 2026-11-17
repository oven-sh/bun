// A store that one side of a branch makes stands between where an object is written and the arm that keeps it.
const kept = [];
function pick(turnsOver, keeps) {
    const made = { mode: "first", weight: 1 };
    if (turnsOver)
        made.mode = "second";
    if (keeps)
        kept.push(made);
    return kept.length;
}
function pickList(turnsOver, keeps) {
    const made = ["first", 1];
    if (turnsOver)
        made[0] = "second";
    if (keeps)
        kept.push(made);
    return kept.length;
}
const ways = { pick, pickList };
for (const name of Object.keys(ways)) {
    for (let i = 0; i < 8; i++)
        ways[name]((i & 1) === 1, (i & 2) === 2);
}
console.log(kept.map(made => Array.isArray(made) ? made[0] : made.mode).join(" "));
