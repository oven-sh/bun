// In each turn of a loop under a catch that reads the text in which a text grows, an inner loop goes on while the text is what it was.
function shape(n: number): string {
    let s = "";
    let out = 0;
    let seen = "a";
    try {
        for (let i = 0; i < n; i++) {
            s += "a";
            let turns = 0; while (s === seen && turns < 2) turns++; out += turns; seen = i % 2 ? s : seen;
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
