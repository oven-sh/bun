// Lists whose elements got their members later, or hold a null or an element with one more property, are written as JSON by compiled code.
// Env: JSC_aotCountsPath=/dev/null
declare const aotRuntimeCounters: undefined | (() => string);
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
// The texts that JSON.stringify left to the engine's own writer, and the values that compiled code handed to the run time.
const leftToTheEngine = () => (counted ? Number(/(\d+)\tcounter:JSONStringifySlowPaths/.exec(aotRuntimeCounters!())?.[1] ?? 0) + counted("operationAOTJSONAppendValue") + counted("operationAOTStringBuilderAppendJSON") : 0);
const left: string[] = [];
interface Item { id: number; title?: string; price?: number }
interface Page { total: number; rows: Item[] }
interface Pair { id: number; name: string }
function whole(i: number): Item {
    return { id: i, title: "item " + i, price: i + 0.25 };
}
function builtUp(i: number): Item {
    const made: Item = { id: i };
    if (i & 1) made.price = i + 0.25;
    made.title = "item " + i;
    return made;
}
function sum(text: string): number {
    let value = 0;
    for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) | 0;
    return value;
}
function measure(label: string, run: () => string): void {
    const before = leftToTheEngine();
    let text = "";
    for (let i = 0; i < 100; i++) text = run();
    if (leftToTheEngine() !== before) left.push(label);
    console.log(label + ": " + (text.length < 150 ? text : text.length + " characters, " + sum(text)));
}
function list(count: number, make: (i: number) => Item): Item[] {
    const made: Item[] = [];
    for (let i = 0; i < count; i++) made.push(make(i));
    return made;
}
const allWhole = list(3, whole);
const allBuiltUp = list(3, builtUp);
const lastBuiltUp = list(3, i => i === 2 ? builtUp(i) : whole(i));
const firstBuiltUp = list(3, i => i === 0 ? builtUp(i) : whole(i));
const one = list(1, builtUp);
const none: Item[] = [];
const long = list(400, builtUp);
const longBehindWhole = list(400, i => i < 200 ? whole(i) : builtUp(i));
const wide = list(3, builtUp);
wide[2].title = "中文";
const withNull: (Item | null)[] = [whole(0), null, builtUp(2), null];
const extra = list(3, whole);
(extra[1] as any).more = true;
const pairs: Pair[] = [{ id: 0, name: "zero" }, { id: 1, name: "one" }, { id: 2, name: "two" }, { id: 3, name: "three" }];
(pairs[1] as any).more = true;
const manyPairs: Pair[] = [];
for (let i = 0; i < 400; i++) manyPairs.push({ id: i, name: "pair " + i });
(manyPairs[200] as any).more = true;
const widePairs: Pair[] = [{ id: 0, name: "zero" }, { id: 1, name: "one" }, { id: 2, name: "\u4e2d\u6587" }];
(widePairs[1] as any).more = true;
const page: Page = { total: 3, rows: allBuiltUp };
const pages: Page[] = [{ total: 3, rows: allBuiltUp }, { total: 3, rows: allWhole }, { total: 3, rows: lastBuiltUp }];
const lists: Item[][] = [allWhole, allBuiltUp, lastBuiltUp];

measure("every element as it was born", () => JSON.stringify(allWhole));
measure("every element built up", () => JSON.stringify(allBuiltUp));
measure("the last built up", () => JSON.stringify(lastBuiltUp));
measure("the first built up", () => JSON.stringify(firstBuiltUp));
measure("one element", () => JSON.stringify(one));
measure("no element", () => JSON.stringify(none));
measure("four hundred built up", () => JSON.stringify(long));
measure("two hundred built up behind two hundred", () => JSON.stringify(longBehindWhole));
measure("a 16-bit string in the rest", () => JSON.stringify(wide));
measure("nulls among them", () => JSON.stringify(withNull));
measure("one with an extra property", () => JSON.stringify(extra));
measure("no optional members, one with an extra property", () => JSON.stringify(pairs));
measure("the same among four hundred", () => JSON.stringify(manyPairs));
measure("the same with a 16-bit string behind it", () => JSON.stringify(widePairs));
measure("in a record", () => JSON.stringify(page));
measure("in records in a list", () => JSON.stringify(pages));
measure("lists in a list", () => JSON.stringify(lists));
console.log("needed the engine: " + left.join(" | "));
