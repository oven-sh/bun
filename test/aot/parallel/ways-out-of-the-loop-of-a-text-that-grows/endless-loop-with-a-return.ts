// A text grows in a loop, and an endless loop is left by a return alone.
function shape(n: number): string {
    let s = "";
    for (;;) {
        if (s.length >= n)
            return s.length + "|" + s.slice(0, 8);
        s += "ab";
    }
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
