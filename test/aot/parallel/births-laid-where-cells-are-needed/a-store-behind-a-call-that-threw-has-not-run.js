// Stores under a handler stand between where an object is written and the arm that keeps it: what it holds says how far the block came.
const kept = [];
function guarded(work, keeps) {
    const made = { step: 0 };
    try {
        work(0);
        made.step = 1;
        work(1);
        made.step = 2;
    } catch {
    }
    if (keeps)
        kept.push(made);
    return kept.length;
}
function guardedList(work, keeps) {
    const made = [0];
    try {
        work(0);
        made[0] = 1;
        work(1);
        made[0] = 2;
    } catch {
    }
    if (keeps)
        kept.push(made);
    return kept.length;
}
const throwsAt = at => place => {
    if (place === at)
        throw new Error("stop");
};
const ways = { guarded, guardedList };
for (const name of Object.keys(ways)) {
    for (let i = 0; i < 12; i++)
        ways[name](throwsAt(i % 3), (i & 1) === 0);
}
console.log(kept.map(made => Array.isArray(made) ? made[0] : made.step).join(" "));
