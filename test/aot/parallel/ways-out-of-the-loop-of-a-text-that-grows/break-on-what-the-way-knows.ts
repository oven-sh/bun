// A text grows in a loop, and the loop is left by a break under a condition that the way to it has already tested.
function shape(n: number): string {
    let s = "";
    const early = n > 3;
    for (let i = 0; i < n; i++) {
        s += "a";
        if (early) {
            if (early)
                break;
            s += "never";
        }
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
