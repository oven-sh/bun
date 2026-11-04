// A text grows in a loop, and a chain of compares of the text leaves the loop by a break and by a return.
function shape(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) {
        s += i % 2 ? "b" : "a";
        if (s === "ab")
            break;
        else if (s === "abc")
            return "never " + s;
    }
    return s;
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
