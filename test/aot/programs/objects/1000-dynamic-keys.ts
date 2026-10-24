// Large dictionaries whose key strings were made among other strings, so that they lie at regular distances in memory: every key is read, stored to and asked for over and over.
const lines: string[] = [];
function fill(count: number, others: number): [Record<string, number>, string[], string[]] {
    const table: Record<string, number> = {};
    const keys: string[] = [];
    const kept: string[] = [];
    for (let i = 0; i < count; i++) {
        keys.push("name" + i);
        for (let k = 0; k < others; k++) kept.push("other" + k + "of" + i);
    }
    for (let i = 0; i < count; i++) table[keys[i]] = i;
    return [table, keys, kept];
}
for (const others of [0, 1, 2, 3, 5, 7]) {
    const [table, keys, kept] = fill(900, others);
    let sum = 0;
    for (let round = 0; round < 12; round++) {
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const held = table[key];
            if (held !== undefined) {
                sum += held;
                table[key] = held + 1;
            } else
                sum -= 1000;
            if (key in table) sum++;
            if (round === 5 && i % 100 === 0) delete table[key];
            if (round === 7 && i % 100 === 0) table[key] = i;
        }
        for (let i = 0; i < kept.length; i += 7) if (table[kept[i]] !== undefined || kept[i] in table) sum += 1000000;
    }
    lines.push(others + " others between two keys: " + sum + " " + Object.keys(table).length + " " + kept.length);
}
console.log(lines.join("\n"));
