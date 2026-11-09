// A text grows in a loop, and a case of a switch on the text leaves the loop, and the text is read behind it.
function shape(n: number): string {
    let s = "";
    outer: for (let i = 0; i < n; i++) {
        s += "a";
        switch (s) {
        case "aaa":
            break outer;
        case "a":
            s += "b";
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
