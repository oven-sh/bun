// In each turn of a loop in which a text grows through a helper, two texts that grow in one loop are compared.
function more(text: string, part: string): string {
    return text + part;
}

function shape(n: number): string {
    let s = "";
    let out = 0;
    let t = "";
    for (let i = 0; i < n; i++) {
        s = more(s, "a");
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
