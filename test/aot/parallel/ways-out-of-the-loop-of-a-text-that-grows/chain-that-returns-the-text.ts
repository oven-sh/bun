// A text grows in a loop, and a chain of compares of the text returns what the compare has proven of it.
function shape(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) {
        s += "a";
        if (s === "x")
            return "never";
        else if (s === "aaa")
            return s;
        else if (s === "aaaaa")
            return "never " + s;
    }
    return "end " + s;
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
