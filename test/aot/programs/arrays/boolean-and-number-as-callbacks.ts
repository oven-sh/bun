// `list.filter(Boolean)` and `list.map(Number)`: the engine's own Boolean and Number are not called once an element: the loop asks and converts in place. Whatever cannot be done in place (an object that converts itself, a symbol, a list that is no plain array, a function of the program that has the name) goes the way it always went. Held to plain Bun.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string {
    if (Array.isArray(value)) {
        let text = "";
        for (let i = 0; i < value.length; i++) text += (i ? "," : "") + (i in value ? show(value[i]) : "hole");
        return value.constructor.name + "[" + text + "]";
    }
    if (Object.is(value, -0)) return "-0";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "bigint") return value + "n";
    if (typeof value === "symbol" || typeof value === "function") return typeof value;
    if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
    return String(value);
}
function tell(name: string, make: () => unknown): void {
    let text: string;
    try { text = show(make()); } catch (e) { text = "threw " + (e as Error).constructor.name + ": " + (e as Error).message; }
    console.log(name + ": " + text);
}
class Rows<T> extends Array<T> {}
const one = 1;
const rope = "1" + one + "2" + one;
const everything: unknown[] = [0, -0, NaN, 1, -1, 0.5, "", "a", " ", "0", null, undefined, false, true, {}, [], 0n, 1n, Symbol("s"), () => 0];

tell("everything", () => everything.filter(Boolean));
tell("strings or nothing", () => (["a", null, "", "b", undefined] as (string | null | undefined)[]).filter(Boolean));
tell("integers", () => [0, 1, 2, 0, 3].filter(Boolean));
tell("fractions", () => [0.5, 0, -0, 1.5, 0].filter(Boolean));
tell("objects", () => [{ a: 1 }, null, { b: 2 }].filter(Boolean));
tell("none", () => ([] as unknown[]).filter(Boolean));
tell("all false", () => [0, "", null].filter(Boolean));
tell("a hole", () => [1, , 2, , 0].filter(Boolean));
tell("a hole among fractions", () => [1.5, , 0, 2.5].filter(Boolean));
tell("with this", () => [0, 1].filter(Boolean, { any: 1 }));
tell("an heir", () => Rows.from([0, 1, "", "x"]).filter(Boolean));
tell("frozen", () => Object.freeze([0, 1, "", "x"]).filter(Boolean));
tell("like an array", () => Array.prototype.filter.call({ length: 3, 0: 0, 1: "x", 2: null }, Boolean));
tell("sparse", () => { const list: unknown[] = [1]; list[5000] = 2; list[9000] = 0; return list.filter(Boolean); });
tell("many", () => { const list: number[] = []; for (let i = 0; i < 3000; i++) list.push(i % 3); return list.filter(Boolean).length; });
tell("a function of the program that has the name", () => { const Boolean = (x: unknown) => x === 0; return [0, 1, 0].filter(Boolean); });
tell("kept in a variable", () => { const keep = Boolean; return [0, 1, ""].filter(keep); });
tell("the result is another list", () => { const list = [1, 2]; return list.filter(Boolean) !== list; });

tell("numerals", () => ["1", "2.5", "-3", "1e3", "0x10", "0b11", "  7  ", "", " ", "abc", "Infinity", "-Infinity", "-0", "+4", "1_000", "٣"].map(Number));
tell("a rope", () => [rope, rope + rope].map(Number));
tell("numbers", () => [1, 2.5, -0, NaN].map(Number));
tell("integers to numbers", () => [1, 2, 3].map(Number));
tell("fractions to numbers", () => [1.5, 2.5].map(Number));
tell("strings and numbers", () => (["1", 2, "3.5"] as unknown[]).map(Number));
tell("nothing, true and false", () => ([null, undefined, true, false] as unknown[]).map(Number));
tell("strings, then nothing", () => (["1", "2", null, "4"] as unknown[]).map(Number));
tell("big integers", () => ([1n, "2", 2n ** 70n] as unknown[]).map(Number));
tell("a symbol", () => (["1", Symbol("s")] as unknown[]).map(Number));
tell("objects that convert themselves", () => (["1", { valueOf: () => 7 }, [8], new Date(9), {}] as unknown[]).map(Number));
tell("an object that changes the list", () => { const list: unknown[] = ["1", null, "3", "4"]; list[1] = { valueOf() { list[2] = "30"; list.length = 3; return 2; } }; return list.map(Number); });
tell("no strings", () => ([] as string[]).map(Number));
tell("a hole among strings", () => ["1", , "3"].map(Number));
tell("a hole among fractions, to numbers", () => [1.5, , 3.5].map(Number));
tell("an heir of strings", () => Rows.from(["1", "2"]).map(Number));
tell("split", () => "3,1,2".split(",").map(Number));
tell("like an array of strings", () => Array.prototype.map.call({ length: 2, 0: "5", 1: "6" }, Number));
tell("many strings", () => { const list: string[] = []; for (let i = 0; i < 3000; i++) list.push(String(i)); const made = list.map(Number); return made.length + " " + made[2999]; });
tell("a function of the program named Number", () => { const Number = (x: unknown) => "n" + x; return ["1"].map(Number); });
tell("Number kept in a variable", () => { const convert = Number; return ["1", "x"].map(convert); });
