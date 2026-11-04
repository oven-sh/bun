// A value is loosely compared with a text that is no number, and the value is an object that converts: by valueOf first, by toString, by Symbol.toPrimitive, and one that throws.
let log = "";
function isWord(x: any) {
    return x == "word";
}
function deed(x: any) {
    try {
        return String(isWord(x));
    } catch (e) {
        return (e as Error).message;
    }
}
const byText = { toString() { log += "s"; return "word"; } };
const byValue = { valueOf() { log += "v"; return "word"; }, toString() { log += "!"; return "other"; } };
const byBoth = { valueOf() { log += "o"; return {}; }, toString() { log += "t"; return "word"; } };
const byHint = { [Symbol.toPrimitive](hint: string) { log += hint; return "word"; } };
const thrower = { valueOf() { log += "x"; throw new RangeError("thrown in valueOf"); } };
console.log(deed("word"), deed("words"), deed(0), deed(NaN), deed(null), deed(undefined), deed(true));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(i & 1 ? "word" : "wor" + "d".repeat(i & 2));
console.log(last);
console.log(deed(byText), deed(byValue), deed(byBoth), deed(byHint), deed(thrower), deed(["word"]), deed([]), deed({}));
console.log(log);
console.log(deed(new String("word")), deed(Symbol("word")), deed(1n));
