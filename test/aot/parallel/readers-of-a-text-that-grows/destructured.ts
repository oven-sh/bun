// In each turn of a loop in which a text grows, the text is destructured as a list and as an object.
function shape(n: number): string {
    let s = "";
    let out = 0;
    for (let i = 0; i < n; i++) {
        s += "a";
        const [first] = s; const { length } = s; out += (first === "a" ? 1 : 100) + length;
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
