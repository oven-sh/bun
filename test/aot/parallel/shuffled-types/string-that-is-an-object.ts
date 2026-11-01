// A parameter declared string is handed a String object, a list and a number. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function f42(s: string): unknown { try { return [s.length, s + "!", s === "ab", typeof s, s.charAt(0), `${s}`]; } catch (e) { return "throws " + (e as Error).constructor.name; } }
for (let i = 0; i < 30; i++) f42("x" + i); show(f42(new String("ab") as unknown as string), f42(["a", "b"] as unknown as string), f42(12 as unknown as string));
export {};
