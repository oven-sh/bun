// In each turn of a for..of loop in which a text grows, the text is compared with <, <=, > and >=.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const turns: number[] = Array.from({ length: n }, (_, index) => index);
    for (const i of turns) {
        s += "a";
        if (s < "aab") out += 1; if (s <= "aa") out += 10; if (s > "aa") out += 100; if (s >= "aaaa") out += 1000;
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
