// One operation off a field that is written a text, a list or a number: its length, its truth. The fields hold every kind of value.
const report = (value: unknown) => console.log(value);
interface Holder { text?: string; list?: number[]; count?: number; }
function lengthOfText(holder: Holder): number { return holder.text!.length; }
function lengthOfList(holder: Holder): number { return holder.list!.length; }
function hasList(holder: Holder): number { return holder.list ? 1 : 2; }
function hasCount(holder: Holder): number { return holder.count ? 1 : 2; }
function tell(f: () => unknown) { try { const answer = f(); report(typeof answer + " " + String(answer)); } catch (e) { report((e as Error).name); } }
const holders: unknown[] = [{ text: "four", list: [1, 2, 3], count: 4 }, { text: "", list: [], count: 0 }, { text: "a" + "b".repeat(3), list: [1.5], count: -1 }, { text: 5, list: 6, count: "7" }, { text: { length: 8 }, list: { length: 9 }, count: {} }, { text: [1], list: "ab", count: "" }, { text: null, list: null, count: null }, { text: true, list: false, count: true }, { text: 1n, list: 0n, count: 0n }, { text: Symbol.iterator, list: Symbol.iterator, count: Symbol.iterator }, { text: () => 1, list: (a: unknown, b: unknown) => 2, count: NaN }, { count: 0.5, list: -0, text: new String("abc") }, {}];
for (const holder of holders) { tell(() => lengthOfText(holder as Holder)); tell(() => lengthOfList(holder as Holder)); tell(() => hasList(holder as Holder)); tell(() => hasCount(holder as Holder)); }
report("end");
