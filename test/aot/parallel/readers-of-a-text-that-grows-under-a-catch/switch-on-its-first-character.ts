// In each turn of a loop under a catch that reads the text in which a text grows, a character of the text is the subject of a switch.
function shape(n: number): string {
    let s = "";
    let out = 0;
    try {
        for (let i = 0; i < n; i++) {
            s += i < 2 ? "" : "a";
            switch (s[0]) { case "a": out += 1; break; case undefined: out += 100; break; default: out += 10000; }
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
