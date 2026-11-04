// In each turn of a for..of loop in which a text grows, the text is the subject of a switch whose cases fall through.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const turns: number[] = Array.from({ length: n }, (_, index) => index);
    for (const i of turns) {
        s += "a";
        switch (s) { case "a": out += 1; case "aa": out += 10; break; case "aaa": out += 100; default: out += 10000; }
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
