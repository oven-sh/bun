// A text grows in a loop, and the loop has one turn by what is written.
function shape(n: number): string {
    let s = "x";
    for (let i = 0; i < 1; i++)
        s += "a" + n;
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
