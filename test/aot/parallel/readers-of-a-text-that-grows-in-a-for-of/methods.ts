// In each turn of a for..of loop in which a text grows, methods of the text are called.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const turns: number[] = Array.from({ length: n }, (_, index) => index);
    for (const i of turns) {
        s += "a";
        out += s.indexOf("aa") + s.slice(1).length + s.toUpperCase().length + (s.startsWith("a") ? 1 : 0) + s.split("a").length + s.repeat(2).length + s.padEnd(3, "x").length;
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
