// In each turn of a loop in which a text grows through a helper, two loops are left at once by what the text is.
function more(text: string, part: string): string {
    return text + part;
}

function shape(n: number): string {
    let s = "";
    let out = 0;
    outer: for (let i = 0; i < n; i++) {
        s = more(s, "a");
        for (let j = 0; j < 2; j++) { if (s === "aaa") break outer; out += 1; }
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
