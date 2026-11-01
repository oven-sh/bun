// What is awaited as a promise of a number settles with a text. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
async function f37(p: Promise<number>): Promise<unknown> { const n = await p; return [n + 1, typeof n]; }
for (let i = 0; i < 5; i++) await f37(Promise.resolve(i));
const fake = { then(r: (v: string) => void) { r("text"); } } as unknown as Promise<number>; show(await f37(fake), await f37(Promise.resolve("s" as unknown as number)));
export {};
