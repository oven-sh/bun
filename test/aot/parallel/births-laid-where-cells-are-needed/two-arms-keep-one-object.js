// Two arms, one behind the other, keep the same object: a Set counts how many there are.
const kept = [];
function twice(first, second) {
    const made = { weight: kept.length };
    if (first)
        kept.push(made);
    if (second)
        kept.push(made);
    return kept.length;
}
function twiceAList(first, second) {
    const made = [kept.length];
    if (first)
        kept.push(made);
    if (second)
        kept.push(made);
    return kept.length;
}
const ways = { twice, twiceAList };
for (const name of Object.keys(ways)) {
    for (let i = 0; i < 8; i++)
        ways[name]((i & 1) === 1, (i & 2) === 2);
}
console.log(kept.length, new Set(kept).size, kept.map(made => Array.isArray(made) ? made[0] : made.weight).join(" "));
