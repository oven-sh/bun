// Number is called without an argument, which gives 0 where undefined gives NaN, and with a BigInt, which it converts where the conversion of an operator throws.
function ofNothing() {
    return Number();
}
function ofUndefined() {
    const nothing: any = undefined;
    return Number(nothing);
}
function ofEither(x: any) {
    const value: any = typeof x === "bigint" ? x : typeof x === "number";
    return Number(value);
}
function deed(x: any) {
    return String(ofNothing()) + " " + String(ofUndefined()) + " " + String(ofEither(x));
}
console.log(deed(1));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(i & 1 ? i : "text");
console.log(last);
console.log(deed(12n));
console.log(String(Number(null)), String(Number(true)), String(Number("")), String(new Number(5) instanceof Number));
