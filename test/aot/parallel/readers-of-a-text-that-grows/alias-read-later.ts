// In each turn of a loop in which a text grows, another name is given to the text and read behind the next growth.
function shape(n: number): string {
    let s = "";
    let out = 0;
    let before = "";
    for (let i = 0; i < n; i++) {
        s += "a";
        out += before.length; before = s;
    }
    return out + "|" + before.length + "|" + s.length;
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
