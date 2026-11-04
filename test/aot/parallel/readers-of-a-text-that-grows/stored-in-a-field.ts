// In each turn of a loop in which a text grows, the text is stored in a field.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const holder = { text: "" };
    for (let i = 0; i < n; i++) {
        s += "a";
        holder.text = s; out += holder.text.length;
    }
    return out + "|" + holder.text.length;
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
