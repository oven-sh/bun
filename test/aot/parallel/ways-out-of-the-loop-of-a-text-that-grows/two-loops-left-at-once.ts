// A text grows in a loop, and two loops are left at once, and the texts of both are read behind them.
function shape(n: number): string {
    let s = "";
    let t = "";
    outer: for (let i = 0; i < n; i++) {
        s += "a";
        t = "";
        for (let j = 0; j < n; j++) {
            t += "b";
            if (i === 2 && j === 1)
                break outer;
        }
    }
    return s + "|" + t.length;
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
