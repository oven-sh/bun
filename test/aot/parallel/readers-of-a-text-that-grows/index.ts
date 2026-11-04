// In each turn of a loop in which a text grows, a character of the text is read by index, by at() and by charCodeAt().
function shape(n: number): string {
    let s = "";
    let out = 0;
    for (let i = 0; i < n; i++) {
        s += "a";
        out += s[i] === "a" ? 1 : 100; out += s.at(-1) === "a" ? 10 : 1000; out += s.charCodeAt(0);
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
