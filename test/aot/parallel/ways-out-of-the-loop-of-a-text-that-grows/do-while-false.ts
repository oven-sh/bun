// A text grows in a loop, and the body of a do..while (false) joins to the text.
function shape(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) {
        do {
            s += "a";
            if (i % 2)
                break;
            s += "b";
        } while (false);
    }
    return s.length + "|" + s.slice(0, 12);
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
