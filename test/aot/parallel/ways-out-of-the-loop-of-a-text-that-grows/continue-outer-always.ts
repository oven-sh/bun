// A text grows in a loop, and the loop of the text is always left by a continue of the loop around.
function shape(n: number): string {
    let seen = "";
    outer: for (let i = 0; i < n; i++) {
        let s = "";
        for (let j = 0; j < n; j++) {
            s += "a";
            if (true)
                continue outer;
        }
        seen += s.length;
    }
    return seen;
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
