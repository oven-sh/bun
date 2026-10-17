// Helpers that are only ever handed functions written at the call: what the functions yield is tested for truth, stored, or both.
interface Item { id: number; label: string; next: Item | undefined }
const items: Item[] = [];
for (let i = 0; i < 6; i++) items.push({ id: i, label: i % 2 ? "" : "item" + i, next: undefined });
for (let i = 0; i + 1 < items.length; i++) items[i].next = items[i + 1];
const first = items[0];
const lines: string[] = [];
function say(label: string, value: unknown): void { lines.push(label + ": " + String(value)); }

function countTrue(item: Item | undefined, test: (item: Item) => boolean): number {
    if (item === undefined) return 0;
    return (test(item) ? 1 : 0) + countTrue(item.next, test);
}
say("all yield a boolean", countTrue(first, item => item.id > 2) + countTrue(first, item => item.label === "") * 10 + countTrue(first, () => true) * 100 + countTrue(first, () => false) * 1000);

function countNot(item: Item | undefined, test: (item: Item) => boolean): number {
    if (item === undefined) return 0;
    return (!test(item) ? 1 : 0) + countNot(item.next, test);
}
say("negated", countNot(first, item => item.id > 2));

function countTruthy(item: Item | undefined, test: (item: Item) => unknown): number {
    if (item === undefined) return 0;
    return (test(item) ? 1 : 0) + countTruthy(item.next, test);
}
say("numbers, strings, objects, NaN, undefined", [countTruthy(first, item => item.id), countTruthy(first, item => item.label), countTruthy(first, item => item.next), countTruthy(first, item => item.id / 0 - item.id / 0), countTruthy(first, () => undefined), countTruthy(first, item => item.id > 3)].join(" "));

function collect(item: Item | undefined, test: (item: Item) => boolean, into: unknown[]): number {
    if (item === undefined) return 0;
    const answer = test(item);
    into.push(answer);
    return (answer ? 1 : 0) + collect(item.next, test, into);
}
const answers: unknown[] = [];
say("tested and stored", collect(first, item => item.id % 3 === 0, answers) + " " + answers.join() + " " + typeof answers[0]);

function firstTrue(item: Item | undefined, test: (item: Item) => boolean): boolean {
    if (item === undefined) return false;
    return test(item) || firstTrue(item.next, test);
}
say("yielded on", firstTrue(first, item => item.id === 4) + " " + firstTrue(first, item => item.id === 40));

function maybe(item: Item | undefined, test?: (item: Item) => boolean): number {
    if (item === undefined) return 0;
    return (test === undefined || test(item) ? 1 : 0) + maybe(item.next, test);
}
say("left out, or given", maybe(first) + " " + maybe(first, item => item.id < 2));

function throwing(item: Item | undefined, test: (item: Item) => boolean): string {
    if (item === undefined) return "";
    let mark: string;
    try { mark = test(item) ? "y" : "n"; } catch (error) { mark = (error as Error).message; }
    return mark + throwing(item.next, test);
}
say("a predicate that throws", throwing(first, item => { if (item.id === 3) throw new Error("!"); return item.id > 3; }));
console.log(lines.join("\n"));
