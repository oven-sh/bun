// A literal spreads a value that is proven a text, and one that is proven a number: of the primitives only a text has own properties. Each is proven by its making, `"" + x` and `+x`, behind the test that lets it through.
function keysOf(x: unknown) {
    if (typeof x === "string")
        return Object.keys({ first: 1, ...(("" + x) as any) }).join();
    if (typeof x === "number")
        return Object.keys({ first: 1, ...((+x) as any), last: 2 }).join();
    if (typeof x === "boolean" || typeof x === "symbol" || typeof x === "bigint")
        return Object.keys({ first: 1, ...(x as any), last: 2 }).join();
    return "other";
}
function deed(x: unknown) {
    return keysOf(x);
}
const input = JSON.parse('[7, true, "ab", ""]');
console.log(deed(input[0]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(input[i & 1]);
console.log(last);
console.log(deed(input[2]));
console.log(deed(input[3]), deed(Symbol.iterator), deed(5n), deed(NaN), deed(null));
