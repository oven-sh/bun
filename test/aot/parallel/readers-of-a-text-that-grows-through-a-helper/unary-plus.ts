// In each turn of a loop in which a text grows through a helper, the text is converted to a number.
function more(text: string, part: string): string {
    return text + part;
}

function shape(n: number): string {
    let s = "";
    let out = 0;
    for (let i = 0; i < n; i++) {
        s = more(s, "1");
        out += +s % 1000; out += Number(s) % 1000; out += ((s as any) * 1) % 1000; out += parseInt(s) % 1000;
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
