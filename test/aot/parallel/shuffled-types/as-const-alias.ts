// An object written `as const` is changed through a second name between two reads. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
const table = { a: 1, b: [1, 2] } as const;
function read(f: () => void): number { const x = table.a; f(); return x + table.a + table.b.length + table.b[0]; }
for (let i = 0; i < 30; i++) read(() => {});
const open11: { a: number; b: number[] } = table as unknown as { a: number; b: number[] }; show(read(() => { open11.a = 50; open11.b.push(9); open11.b[0] = 7; }));
export {};
