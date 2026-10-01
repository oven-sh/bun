function f(x: string | number | undefined, a: (string | number)[]) {
    let y = x;
    while (typeof y === "string") {
        y = y.length > 1 ? 1 : undefined;
    }
    for (const v of a) {
        if (typeof v === "number") continue;
        v.toUpperCase();
    }
    if (x === undefined) return 0;
    return x;
}
function g(k: { kind: "a"; n: number } | { kind: "b"; s: string }) {
    switch (k.kind) {
        case "a": return k.n;
        case "b": return k.s;
    }
    k;
}
let z;
z = 1;
z = "s";
const w: number = z;
