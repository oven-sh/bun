// In each turn of a for..of loop in which a text grows, the text is the index of a list.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const turns: number[] = Array.from({ length: n }, (_, index) => index);
    const list = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    for (const i of turns) {
        s += "1";
        out += (list as any)[s] ?? 1000;
    }
    return out + "|" + s.length;
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
