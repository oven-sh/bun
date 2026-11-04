// A text grows in a loop, and the loop is left by a break under the negation of what the way to it has tested.
function shape(n: number): string {
    let s = "";
    const late = n < 4;
    for (let i = 0; i < n; i++) {
        s += "a";
        if (!late) {
            if (!!late)
                s += "never";
            else
                break;
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
