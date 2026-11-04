// In each turn of a loop in which a text grows, the text is a case of a switch on another value.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const want: string = "aaa";
    for (let i = 0; i < n; i++) {
        s += "a";
        switch (want) { case s: out += 1; break; default: out += 100; }
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
