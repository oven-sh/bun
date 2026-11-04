// In each turn of a for..of loop in which a text grows, the text is the key of a store.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const turns: number[] = Array.from({ length: n }, (_, index) => index);
    const table: Record<string, number> = {};
    for (const i of turns) {
        s += "a";
        table[s] = i;
    }
    return Object.keys(table).length + "|" + Object.keys(table).slice(0, 5).join() + "|" + s.length;
}

function deed(n: number) {
    try {
        console.log(n, shape(n));
    } catch (thrown) {
        console.log(n, "threw", typeof thrown === "string" ? thrown : (thrown as Error).name + ": " + (thrown as Error).message);
    }
}

for (const n of [0, 1, 2, 3, 4, 5, 9, 40, 200])
    deed(n);
