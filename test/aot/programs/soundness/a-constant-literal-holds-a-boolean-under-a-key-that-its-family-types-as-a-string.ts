// An index signature admits the key, so `{ flag: true }` is constant data of the named type, which declares no such member.
// Another literal that was passed for the same type parameter declares `flag` as a string, and unknown code may hold the objects.
// The slot that the compiler gives `flag` in the named type has to admit what the constant data holds.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
type Meta = { a?: string; b?: string; [key: string]: boolean | number | string | undefined };
const sink: [string, Meta][] = [];
function keep<T extends object>(x: T): T { return x; }
function logEvent(name: string, metadata: Meta): void { sink.push([name, keep(metadata)]); (globalThis as any).hook?.(metadata); }
logEvent("one", { flag: true });
logEvent("two", { flag: process.argv.length > 5 });
logEvent("three", { flag: 3, a: "a" });
logEvent("four", { flag: "text" });
console.log(keep({ flag: String(process.argv.length > 5) }).flag);
for (const [name, m] of sink) console.log(name, m.flag, typeof m.flag, m.a);
sink[0][1].flag = "now a string";
sink[3][1].flag = false;
for (const [name, m] of sink) console.log(name, m.flag, typeof m.flag);
