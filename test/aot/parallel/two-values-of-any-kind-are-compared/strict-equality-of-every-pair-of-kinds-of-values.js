// `a === b` where nothing is known of either side, asked for its value and asked by a branch, of every pair out of 34 values of every kind:
// undefined, null, the booleans, integers and the same numbers as doubles, both zeros, NaN, infinities, texts (empty, flat, joined and not yet flat, equal in content and apart as cells),
// big integers (small, large, equal in content and apart as cells), symbols, objects, arrays, functions, a Proxy, an object without a prototype.
// The values are made and the questions asked in text that the build has not seen, so no type is known and neither function is copied into its caller.
function isSame(a, b) { return a === b; }
function markOf(a, b) { if (a === b) return "="; return "."; }
function markOfOther(a, b) { if (a !== b) return "."; return "="; }
console.log(new Function("isSame", "markOf", "markOfOther", `
    const joined = (a, b) => a + b;
    const half = Number("0.5");
    const shared = { };
    const values = [
        undefined, null, true, false, 0, -0, 1, half + half, 2147483647, 2147483646 + half + half, -1, NaN, Number("x"), Infinity, -Infinity, 1.5,
        "", "a", joined("long enough to stay ", "a text of two parts"), joined("long enough to stay ", "a text of two parts"), "long enough to stay a text of two parts", String(1), "1",
        1n, BigInt("1"), 2n ** 70n, BigInt("1180591620717411303424"), Symbol.iterator, Symbol("a"), shared, { }, [], () => { }, new Proxy(shared, { }), Object.create(null),
    ];
    const lines = [];
    for (const a of values) {
        let line = "";
        for (const b of values) {
            const mark = markOf(a, b);
            line += mark === markOfOther(a, b) && (mark === "=") === isSame(a, b) ? mark : "!";
        }
        lines.push(line);
    }
    return lines.join("\\n");
`)(isSame, markOf, markOfOther));
