// A typed read of an array element that is an accessor runs the getter, as in plain Bun.
// The result is the same however much the compiler knows about the key: a constant, a number, or a parameter that may be omitted or null.
declare const console: { log(...values: unknown[]): void };
const trace: string[] = [];
function withGetter(): string[] { const a = ["a", "b", "c"]; Object.defineProperty(a, "1", { get() { trace.push("getter"); return "got"; }, configurable: true }); return a; }
function elementAt(a: string[], i: number): string { return a[i]; }
let depth = 0;
function elementAtInFunctionThatCallsItself(a: string[], i: number): string { if (depth > 0) { depth--; elementAtInFunctionThatCallsItself(a, i); } return a[i]; }
function elementAtOptionalKey(a: string[], i?: number): string { if (depth > 0) { depth--; elementAtOptionalKey(a, i); } return a[i as number]; }
function elementAtKeyOrNull(a: string[], i: number | null): string { if (depth > 0) { depth--; elementAtKeyOrNull(a, i); } return a[i as number]; }
function tell(name: string, read: () => unknown): void {
    trace.length = 0;
    let line: string;
    try { line = String(read()); } catch (e) { line = "throws " + (e as Error).constructor.name; }
    console.log(name + ": " + line + " {" + trace.join(",") + "}");
}
for (let round = 0; round < 2; round++) {
    tell("the key a constant", () => withGetter()[1]);
    tell("the key a parameter", () => elementAt(withGetter(), 1));
    tell("in a function that calls itself", () => elementAtInFunctionThatCallsItself(withGetter(), 1));
    tell("the key may be left out", () => elementAtOptionalKey(withGetter(), 1));
    tell("the key may be null", () => elementAtKeyOrNull(withGetter(), 1));
    tell("beside the getter", () => [elementAt(withGetter(), 0), elementAtInFunctionThatCallsItself(withGetter(), 2), elementAtOptionalKey(withGetter(), 0), elementAtKeyOrNull(withGetter(), 2)]);
    tell("beyond the length", () => [elementAt(withGetter(), 3), elementAtInFunctionThatCallsItself(withGetter(), 3), elementAtOptionalKey(withGetter(), 3), elementAtKeyOrNull(withGetter(), 3)]);
    tell("the key left out", () => elementAtOptionalKey(["a", "b"]));
    tell("the key left out, and a property of that name", () => elementAtOptionalKey(Object.assign(["a", "b"], { undefined: "named undefined" })));
    tell("the key null", () => elementAtKeyOrNull(["a", "b"], null));
    tell("the key null, and a property of that name", () => elementAtKeyOrNull(Object.assign(["a", "b"], { null: "named null" }), null));
    tell("no whole number", () => [elementAtOptionalKey(["a", "b"], 0.5), elementAtOptionalKey(["a", "b"], -1), elementAtOptionalKey(["a", "b"], NaN), elementAtKeyOrNull(Object.assign(["a", "b"], { "0.5": "half" }), 0.5)]);
    tell("a store runs the setter", () => { const a = ["a", "b"]; Object.defineProperty(a, "1", { set(v: string) { trace.push("setter " + v); }, configurable: true }); a[1] = "stored"; return a.length; });
}
