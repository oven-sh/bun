// In each turn of a loop under a catch that reads the text in which a text grows, two loops are left at once by what the text is.
function shape(n: number): string {
    let s = "";
    let out = 0;
    try {
        outer: for (let i = 0; i < n; i++) {
            s += "a";
            for (let j = 0; j < 2; j++) { if (s === "aaa") break outer; out += 1; }
        }
    } catch (thrown) {
        return "caught " + s.length + " " + s.slice(0, 8) + " " + out + " " + (typeof thrown === "string" ? thrown.length : (thrown as Error).name);
    }
    return out + "|" + s.length;
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
