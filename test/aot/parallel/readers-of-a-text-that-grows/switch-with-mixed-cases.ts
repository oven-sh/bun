// In each turn of a loop in which a text grows, the text is the subject of a switch with a string, a number, null and undefined for cases.
function shape(n: number): string {
    let s = "";
    let out = 0;
    for (let i = 0; i < n; i++) {
        s += "a";
        switch (s as any) { case "aa": out += 1; break; case 2: out += 100; break; case null: out += 1000; break; case undefined: out += 5000; break; default: out += 10000; }
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
