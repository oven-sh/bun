// In each turn of a for..of loop in which a text grows, two texts that grow in one loop are compared.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const turns: number[] = Array.from({ length: n }, (_, index) => index);
    let t = "";
    for (const i of turns) {
        s += "a";
        t += i % 2 ? "a" : "aa"; if (s === t) out += 1; if (s < t) out += 100;
    }
    return out + "|" + s.length + "|" + t.length;
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
