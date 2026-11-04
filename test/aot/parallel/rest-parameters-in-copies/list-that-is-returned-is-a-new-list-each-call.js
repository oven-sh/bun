function listOf(...xs) { return xs; }
const kept = [];
for (let i = 0; i < 6; i++) kept.push(listOf(i, i + 1));
kept[0].push("more");
kept[1][0] = "other";
console.log(JSON.stringify(kept), kept[2] === kept[3], Array.isArray(kept[4]), kept[5].length);
