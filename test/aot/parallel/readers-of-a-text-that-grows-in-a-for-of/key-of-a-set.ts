// In each turn of a for..of loop in which a text grows, the text is added to a Set.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const turns: number[] = Array.from({ length: n }, (_, index) => index);
    const set = new Set<string>(["aa"]);
    for (const i of turns) {
        s += "a";
        if (set.has(s)) out += 1; set.add(s);
    }
    return out + "|" + set.size + "|" + [...set].slice(0, 5).join();
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
