// In each turn of a loop under a catch that reads the text in which a text grows, the text is a key of a Map.
function shape(n: number): string {
    let s = "";
    let out = 0;
    const map = new Map<string, number>([["aa", 50]]);
    try {
        for (let i = 0; i < n; i++) {
            s += "a";
            if (map.has(s)) out += map.get(s)!; map.set(s, i);
        }
    } catch (thrown) {
        return "caught " + s.length + " " + s.slice(0, 8) + " " + out + " " + (typeof thrown === "string" ? thrown.length : (thrown as Error).name);
    }
    return out + "|" + map.size + "|" + [...map.keys()].slice(0, 5).join();
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
