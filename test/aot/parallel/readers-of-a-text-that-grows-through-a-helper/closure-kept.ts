// In each turn of a loop in which a text grows through a helper, closures that read the text are kept and called behind the loop.
function more(text: string, part: string): string {
    return text + part;
}

function shape(n: number): string {
    let s = "";
    let out = 0;
    const kept: (() => string)[] = [];
    for (let i = 0; i < n; i++) {
        s = more(s, "a");
        kept.push(() => s);
    }
    return kept.slice(0, 6).map(read => read().length).join();
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
