// `new C(..)` where C comes out of a table does not go through the runtime's general construction: for classes of the engine and for a function that asks new.target. The program counts the entries.
declare const aotOperationCount: (name: string) => number;
function entered(): number { return aotOperationCount("operationAOTConstruct"); }
const lines: string[] = [];
function measure(label: string, constructions: number, run: () => number): void {
    const before = entered();
    const result = run();
    const entries = entered() - before;
    lines.push(label + ": " + result + ", " + (entries * 20 < constructions ? "few entries" : entries + " ENTRIES FOR " + constructions + " CONSTRUCTIONS"));
}
function Asks(this: any, value: any): any { if (!new.target) return new (Asks as any)(value + 100); this.value = value; }
const table: any[] = [Map, Set, Date, Error, Asks];
function make(index: number, given: any): any { const C = table[index]; return new C(given); }
measure("maps", 10000, () => { let sum = 0; for (let i = 0; i < 10000; i++) sum += make(0, [[i, i]]).size; return sum; });
measure("sets", 10000, () => { let sum = 0; for (let i = 0; i < 10000; i++) sum += make(1, [i, i + 1]).size; return sum; });
measure("dates", 10000, () => { let sum = 0; for (let i = 0; i < 10000; i++) sum += make(2, i).getTime(); return sum; });
measure("errors", 10000, () => { let sum = 0; for (let i = 0; i < 10000; i++) sum += make(3, "e" + (i & 7)).message.length; return sum; });
measure("a function that asks new.target", 10000, () => { let sum = 0; for (let i = 0; i < 10000; i++) sum += make(4, i & 3).value; return sum; });
measure("the same, called without new", 10000, () => { let sum = 0; for (let i = 0; i < 10000; i++) sum += (Asks as any)(i & 3).value; return sum; });
measure("all in turn", 10000, () => { let sum = 0; for (let i = 0; i < 10000; i++) sum += typeof make(i % 5, undefined) === "object" ? 1 : 0; return sum; });
console.log(lines.join("\n"));
