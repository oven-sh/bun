// A text grows in a loop, and the text is read behind one way out of the loop and dead behind the other.
function shape(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) {
        s += "a";
        if (i === 3)
            return "left early";
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
