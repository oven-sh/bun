// A text grows in a loop, and two texts grow, of which one is read behind the loop.
function shape(n: number): string {
    let s = "";
    let dead = "";
    for (let i = 0; i < n; i++) {
        s += "a";
        dead += "b";
        if (dead.length === 4)
            break;
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
