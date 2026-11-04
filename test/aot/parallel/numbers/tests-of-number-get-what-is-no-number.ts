// The tests of Number, which convert nothing, and isNaN and isFinite of the global object, which convert, get undefined, null, a text and a boolean that are known where they are called.
function ofUndefined() {
    const x: any = undefined;
    return String(Number.isNaN(x)) + String(isNaN(x)) + String(Number.isFinite(x)) + String(isFinite(x));
}
function ofNull() {
    const x: any = null;
    return String(Number.isNaN(x)) + String(isNaN(x)) + String(Number.isFinite(x)) + String(isFinite(x)) + String(Number.isInteger(x));
}
function ofText() {
    const x: any = "7";
    return String(Number.isNaN(x)) + String(isNaN(x)) + String(Number.isFinite(x)) + String(isFinite(x)) + String(Number.isSafeInteger(x));
}
function ofFlag(y: unknown) {
    const x: any = typeof y === "number";
    return String(Number.isNaN(x)) + String(Number.isFinite(x)) + String(Number.isInteger(x));
}
function deed(y: unknown) {
    return ofFlag(y);
}
console.log(deed(1));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(i & 1 ? i : "text");
console.log(last);
console.log(ofUndefined());
console.log(ofNull());
console.log(ofText());
