// `a === b` and `a !== b` where the compiler knows nothing of either side: every kind of value against every kind, the same value twice, and equal content in two cells.
const hide = new Function("v", "return v" + String(process.argv[9] ?? "").slice(99)) as <T>(v: T) => T;
function same(a: unknown, b: unknown): boolean { return a === b; }
function differ(a: unknown, b: unknown): boolean { return a !== b; }
function pick(a: unknown, b: unknown): string { if (a === b) return "="; return "."; }

class Point { constructor(public x: number) {} }
const object = { a: 1 }, array = [1], point = new Point(1), fn = function () {}, arrow = () => 1, symbol = Symbol("s"), date = new Date(0), map = new Map(), regexp = /a/, proxy = new Proxy({}, {}), boxed = Object("text");
const values: [string, unknown][] = [
    ["undefined", undefined], ["null", null], ["true", true], ["false", false],
    ["0", 0], ["-0", -0], ["1", 1], ["1.5", 1.5], ["NaN", NaN], ["Infinity", Infinity], ["2**31", 2 ** 31], ["-2**31", -(2 ** 31)], ["1 as a double", hide(0.5) + 0.5],
    ["empty string", ""], ["a", "a"], ["text", "text"], ["text, built", hide("te") + hide("xt")], ["text, sliced", hide("a text b").slice(2, 6)], ["long", "x".repeat(40)], ["long, built", hide("x".repeat(20)) + hide("x".repeat(20))], ["long, other end", "x".repeat(39) + "y"],
    ["wide text", "tėxt"], ["wide text, built", hide("tė") + hide("xt")], ["1 as text", "1"],
    ["10n", 10n], ["10n, computed", hide(5n) * 2n], ["2n**70n", 2n ** 70n], ["2n**70n, computed", hide(2n) ** 70n], ["-10n", -10n],
    ["symbol", symbol], ["another symbol", Symbol("s")], ["registered symbol", Symbol.for("s")], ["registered symbol again", Symbol.for("s")],
    ["object", object], ["object of the same shape", { a: 1 }], ["array", array], ["another array", [1]], ["point", point], ["another point", new Point(1)],
    ["function", fn], ["arrow", arrow], ["date", date], ["another date", new Date(0)], ["map", map], ["regexp", regexp], ["proxy", proxy], ["boxed text", boxed], ["global object", globalThis], ["Math", Math],
];
for (const [name, a] of values) {
    let row = "";
    for (const [, b] of values) {
        const x = hide(a), y = hide(b);
        const answer = same(x, y);
        if (answer === differ(x, y) || (pick(x, y) === "=") !== answer) throw new Error("the three forms disagree at " + name);
        row += answer ? "=" : ".";
    }
    console.log(row, name);
}
