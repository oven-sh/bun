// A text grows in a loop, and a case of a switch on the text returns the text.
function shape(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) {
        s += "a";
        switch (s) {
        case "aaa":
            return "case " + s;
        default:
            break;
        }
    }
    return "end " + s;
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
