// In each turn of a loop in which a text grows, the text is the key of a delete.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const table: Record<string, number> = { a: 1, aaa: 100, b: 2 };
    for (let i = 0; i < n; i++) {
        s += "a";
        if (delete table[s]) out += 1;
    }
    return out + "|" + Object.keys(table).join();
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
