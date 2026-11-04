// A literal spreads a value that is undefined, false, a number, or an object whose getter changes what is spread behind it: the primitive copies nothing, and the object is copied in the order written.
let log = "";
type Extra = { c: number; d: number };
function widen(extra: Extra | undefined, more: Extra | false | number) {
    return { a: 1, ...extra, b: 2, ...(more as any), e: 5 };
}
function deed(extra: Extra | undefined, more: Extra | false | number) {
    const made: any = widen(extra, more);
    return Object.keys(made).join() + " " + JSON.stringify(made);
}
const plain: Extra = { c: 3, d: 4 };
console.log(deed(plain, false));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(i & 1 ? plain : undefined, i & 2 ? plain : i & 4 ? 7 : false);
console.log(last);
const later: any = { c: 30, d: 40 };
const hostile: any = { get c() { log += "c"; later.d = "changed"; delete later.c; return 300; }, d: 400 };
console.log(deed(hostile, later), log);
console.log(deed(undefined, 0), deed(undefined, NaN), deed(null as any, true as any), deed("xy" as any, "z" as any));
