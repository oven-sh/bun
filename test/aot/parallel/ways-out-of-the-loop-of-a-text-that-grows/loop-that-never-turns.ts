// A text grows in a loop, and the condition of the loop is false from the first.
function shape(n: number): string {
    let s = "x";
    for (let i = n; i < n; i++)
        s += "a";
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
