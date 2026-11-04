// A text grows in a loop, and the loop of the text is left by a continue of the loop around, whose head reads the text.
function shape(n: number): string {
    let last = "";
    let out = 0;
    outer: for (let i = 0; i < n; out += last.length, i++) {
        let s = "";
        for (let j = 0; j <= i; j++) {
            s += "a";
            last = s;
            if (j === 2)
                continue outer;
        }
    }
    return out + "|" + last;
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
