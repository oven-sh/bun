// The same under declared types: the arms go by what the test proves, also where a cast stands around the question or the value.
type Any = string | number | boolean | null | undefined | bigint | symbol | object | (() => number);
const values = (): Any[] => [undefined, null, true, 0, 1.5, 10n, "", "text", Symbol.iterator, {}, [], () => 1, new Date(0)];
const show = (label: string, ask: (value: Any) => unknown) => console.log(label, values().map(value => String(ask(value))).join(" "));

show("kept", (x: Any) => { const kind = typeof x; return kind === "string" ? (x as string).length : kind === "number" ? (x as number) + 1 : kind === "function" ? (x as () => number).length : kind; });
show("kept, under a cast", (x: Any) => { const kind = typeof x as string; return kind === "string" ? (x as string).length : kind; });
show("kept, of a cast", (x: Any) => { const kind = typeof (x as unknown); return kind === "number" ? (x as number) + 1 : kind; });
show("kept, of what is asserted", (x: Any) => { const kind = typeof x!; return kind === "object" ? "object" : kind; });
show("kept, declared", (x: Any) => { const kind: string = typeof x; return kind === "bigint" ? (x as bigint) + 1n : kind; });
show("switched", (x: Any) => { switch (typeof x) { case "string": return x.length; case "number": return x + 1; case "function": return x(); case "object": return x === null ? "null" : Object.keys(x).length; case "bigint": return x * 2n; default: return String(x); } });
show("switched on what is kept", (x: Any) => { const kind = typeof x; switch (kind) { case "string": return (x as string).length; case "boolean": return !x; default: return kind; } });
function either(x: string | number[]): number { switch (typeof x) { case "string": return x.length; case "object": return x.length + 100; } }
console.log(either("abc"), either([1, 2]));
function lying(x: string): string { const kind = typeof x; return kind === "string" ? "text" : `a ${kind} where the type says text`; }
try { console.log(lying(JSON.parse("5"))); } catch (error) { console.log((error as Error).constructor.name); }
