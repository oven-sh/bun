function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f, ...args) {
    try {
        f(...args);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
let read = [];
function thrownByReading(f, ...args) {
    try {
        read.push(f(...args));
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}

function templateOfInt32(n) { let i = n | 0; return `<${i}>`; }
function templateOfNumber(n) { let x = +n; return `<${x}>`; }
function templateOfTwo(a, b) { let i = a | 0, x = +b; return `${i},${x}`; }
function templateOfAnything(value) { return `<${value}>`; }
function templateOfString(value) { let text = "" + value; return `<${text}>`; }
function stringPlusInt32(text, n) { let s = `${text}`; return s + (n | 0); }
function int32PlusString(n, text) { let s = `${text}`; return (n | 0) + s; }
function stringPlusNumber(text, n) { let s = `${text}`; return s + +n; }
function numberPlusString(n, text) { let s = `${text}`; return +n + s; }
function literalPlusInt32(n) { return "n" + (n | 0); }
function stringPlusAnything(text, value) { let s = `${text}`; return s + value; }
function anythingPlusAnything(a, b) { return a + b; }
function stringOfInt32(n) { return String(n | 0); }
function stringOfNumber(n) { return String(+n); }
function int32ToString(n) { return (n | 0).toString(); }
function numberToString(n) { return (+n).toString(); }
function int32ToHexadecimal(n) { return (n | 0).toString(16); }
function counts(limit) { let text = ""; for (let i = 0; i < limit; ++i) text += i; return text; }
function joinsKeys(limit) { let text = ""; for (let i = 0; i < limit; ++i) text += `k${i * 1000003 | 0};`; return text.length; }
const all = [templateOfInt32, templateOfNumber, templateOfTwo, templateOfAnything, templateOfString, stringPlusInt32, int32PlusString, stringPlusNumber, numberPlusString, literalPlusInt32, stringPlusAnything, anythingPlusAnything, stringOfInt32, stringOfNumber, int32ToString, numberToString, int32ToHexadecimal, counts, joinsKeys];
for (let f of all)
    noInline(f);

const integers = [[0, "0"], [1, "1"], [9, "9"], [10, "10"], [255, "255"], [1023, "1023"], [1024, "1024"], [1025, "1025"], [65536, "65536"], [123456789, "123456789"], [2147483647, "2147483647"], [-1, "-1"], [-9, "-9"], [-1024, "-1024"], [-2147483648, "-2147483648"]];
const numbers = [[0.5, "0.5"], [-0, "0"], [-0.5, "-0.5"], [NaN, "NaN"], [Infinity, "Infinity"], [-Infinity, "-Infinity"], [1e21, "1e+21"], [1e-7, "1e-7"], [123456789012, "123456789012"], [2147483648, "2147483648"], [-2147483649, "-2147483649"], [9007199254740991, "9007199254740991"], [0.1 + 0.2, "0.30000000000000004"], [5e-324, "5e-324"], [1.7976931348623157e308, "1.7976931348623157e+308"]];
for (let round = 0; round < 4; ++round) {
    for (let [n, text] of integers) {
        check(templateOfInt32(n), "<" + text + ">", "a template with " + text);
        check(templateOfNumber(n), "<" + text + ">", "a template with the number " + text);
        check(templateOfAnything(n), "<" + text + ">", "a template with the value " + text);
        check(templateOfTwo(n, n), text + "," + text, "a template with " + text + " twice");
        check(stringPlusInt32("s", n), "s" + text, "a string and " + text);
        check(int32PlusString(n, "s"), text + "s", text + " and a string");
        check(stringPlusInt32("", n), text, "the empty string and " + text);
        check(int32PlusString(n, ""), text, text + " and the empty string");
        check(literalPlusInt32(n), "n" + text, "a literal and " + text);
        check(stringPlusAnything("s", n), "s" + text, "a string and the value " + text);
        check(stringOfInt32(n), text, "String(" + text + ")");
        check(int32ToString(n), text, text + ".toString()");
        check(int32ToHexadecimal(n), n.toString(16), text + ".toString(16)");
    }
    for (let [n, text] of integers.concat(numbers)) {
        check(templateOfNumber(n), "<" + text + ">", "a template with the number " + text);
        check(templateOfAnything(n), "<" + text + ">", "a template with the value " + text);
        check(templateOfTwo(1, n), "1," + text, "a template with 1 and " + text);
        check(stringPlusNumber("s", n), "s" + text, "a string and the number " + text);
        check(numberPlusString(n, "s"), text + "s", "the number " + text + " and a string");
        check(stringPlusAnything("s", n), "s" + text, "a string and the value " + text);
        check(anythingPlusAnything("s", n), "s" + text, "a string and the value " + text);
        check(anythingPlusAnything(n, "s"), text + "s", "the value " + text + " and a string");
        check(stringOfNumber(n), text, "String(" + text + ")");
        check(numberToString(n), text, text + ".toString()");
    }
    check(templateOfInt32(1.9), "<1>", "a template with 1.9 | 0");
    check(templateOfNumber("12"), "<12>", "a template with +\"12\"");
    check(stringPlusInt32("中", 7), "中7", "a 16-bit string and 7");
    check(stringPlusInt32("a" + "b".repeat(round), 7).length, round + 2, "a rope and 7");
    for (let [value, text] of [[undefined, "undefined"], [null, "null"], [true, "true"], [false, "false"], ["text", "text"], ["", ""], [7n, "7"], [[1, 2], "1,2"], [{}, "[object Object]"], [{ toString() { return "mine"; } }, "mine"], [{ valueOf() { return 1; }, toString() { return "mine"; } }, "mine"]]) {
        check(templateOfAnything(value), "<" + text + ">", "a template with " + text);
        check(templateOfString(typeof value === "object" && value && value.valueOf !== Object.prototype.valueOf && !Array.isArray(value) ? "mine" : value), "<" + text + ">", "a template with the string " + text);
    }
    check(stringPlusAnything("s", { valueOf() { return 1; }, toString() { return "mine"; } }), "s1", "a string and an object with valueOf");
    check(stringPlusAnything("s", undefined), "sundefined", "a string and undefined");
    check(anythingPlusAnything(1, 2), 3, "1 and 2");
    check(anythingPlusAnything(1n, 2n), 3n, "1n and 2n");
    check(thrownBy(templateOfAnything, Symbol()), "TypeError", "a template with a symbol");
    check(thrownBy(stringPlusAnything, "s", Symbol()), "TypeError", "a string and a symbol");
    check(thrownBy(templateOfAnything, { toString() { throw new RangeError(); } }), "RangeError", "a template with an object whose toString throws");
    check(counts(12), "01234567891011", "numbers appended to a string");
    check(counts(2000).length, 6890, "many numbers appended to a string");
    check(joinsKeys(3000) > 9000, true, "many templates");
    if (round == 1)
        gc();
}

let pieces = ["xy"];
for (let i = 1; i < 30; ++i)
    pieces.push(pieces[i - 1] + pieces[i - 1]);
let long = "";
for (let piece of pieces)
    long = piece + long;
check(long.length, 2 ** 31 - 2, "the length of a long rope");
check(stringPlusInt32(long, 1).length, 2 ** 31 - 1, "the longest string");
check(int32PlusString(1, long).length, 2 ** 31 - 1, "the longest string");
// A text that would be too long throws a RangeError where somebody reads it, as under `bun run`.
check(thrownByReading(stringPlusInt32, long, 10), "RangeError", "a string that would be too long and is read");
check(thrownByReading(int32PlusString, 10, long), "RangeError", "a string that would be too long and is read");
check(read.length, 0, "the texts that were made");
for (let text of read)
    console.log(text.length);
// Where nobody reads it a compiled program need not make it, and then nothing is thrown: the language names no such limit, and an error for lack of room is nothing a program may count on.
check(["RangeError", "nothing"].includes(thrownBy(stringPlusInt32, long, 10)), true, "a string that would be too long and that nobody reads");
check(["RangeError", "nothing"].includes(thrownBy(int32PlusString, 10, long)), true, "a string that would be too long and that nobody reads");
console.log("passed");
