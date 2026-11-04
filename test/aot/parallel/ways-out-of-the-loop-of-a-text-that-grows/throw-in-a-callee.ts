// A text grows in a loop, and a callee that is handed the text throws out of the loop.
function shape(n: number): string {
    let s = "";
    const check = (text: string) => {
        if (text.length === 4)
            throw new RangeError(text);
    };
    for (let i = 0; i < n; i++) {
        s += "a";
        check(s);
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
