// Literals with a computed key beside a written one, in loops and functions.
declare const console: { log(...values: unknown[]): void };
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + JSON.stringify(r)); };
declare function structuredClone<T>(v: T): T;
const sink = (v: unknown) => JSON.stringify(v);
row("as the test has it", () => { const out: string[] = []; const keys = ["{", "a b", "plain"]; for (const key of keys) { const shared = [1, 2]; const obj = { [key]: shared, other: shared }; for (const space of [undefined, 2]) out.push(JSON.stringify(obj, null, space)); } return out.length; });
row("one key", () => { const key: string = "k"; const shared = [1, 2]; const obj = { [key]: shared, other: shared }; return sink(obj); });
row("the written one first", () => { const key: string = "k"; const shared = [1, 2]; const obj = { other: shared, [key]: shared }; return sink(obj); });
row("the computed key IS the written one", () => { const key: string = "other"; const shared = [1, 2]; const obj = { [key]: shared, other: shared }; return sink(obj); });
row("read back", () => { const key: string = "k"; const obj = { [key]: 1, other: 2 }; return obj[key] + obj.other; });
row("handed to a typed function", () => { const key: string = "k"; const obj = { [key]: 1, other: 2 }; const f = (o: { other: number }) => o.other; return f(obj); });
row("an index as a key", () => { const key: string = "0"; const obj = { [key]: 1, other: 2 }; return sink(obj); });
row("many keys in a loop", () => { let n = 0; for (const key of ["\\u{10FFFF}a", "{", "}", "[", "]", ",", "{a}", "key[0]", "a,b", "a\\b", "a b", "a\tb", "a\nb", " ", "key:with#chars", "🙂emoji"]) { const shared = [1, 2]; const obj = { [key]: shared, other: shared }; n += Object.keys(obj).length; } return n; });
