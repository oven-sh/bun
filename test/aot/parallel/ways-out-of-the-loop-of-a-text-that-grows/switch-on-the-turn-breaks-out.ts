// A text grows in a loop, and a case of a switch on the number of the turn leaves the loop.
function shape(n: number): string {
    let s = "";
    outer: for (let i = 0; i < n; i++) {
        s += "a";
        switch (i) {
        case 3:
            break outer;
        case 1:
            s += "b";
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
