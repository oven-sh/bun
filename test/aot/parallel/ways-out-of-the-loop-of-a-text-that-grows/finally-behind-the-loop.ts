// A text grows in a loop, and the loop stands in a try whose finally reads the text.
function shape(n: number): string {
    let s = "";
    let seen = "";
    try {
        for (let i = 0; i < n; i++) {
            s += "a";
            if (i === 3)
                return "early " + s;
        }
    } finally {
        seen = s;
        if (n === 9)
            return "finally " + seen;
    }
    return s + "|" + seen.length;
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
