// Strings that are the name of no property anywhere, asked for again and again by the same string objects; then the name comes to be: on the object, above it, in a dictionary, and goes again.
const lines: string[] = [];
const asked = ["NOTHING_HAS_THIS_ONE", "NOTHING_HAS_THIS_TWO", "NOTHING_HAS_THIS_THREE", "NOTHING_HAS_THIS_FOUR", "NOTHING_HAS_THIS_FIVE", "NOTHING_HAS_THIS_SIX"];
function sameText(index: number): string {
    return ["NOTHING", "HAS", "THIS", ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"][index]!].join("_");
}
function ask(record: Record<string, unknown>, rounds: number): string {
    const seen: string[] = [];
    for (let round = 0; round < rounds; round++) {
        let line = "";
        for (let i = 0; i < asked.length; i++) {
            const value = record[asked[i]!];
            line += value === undefined ? "." : String(value);
        }
        if (seen[seen.length - 1] !== line) seen.push(line);
    }
    return seen.join(" ");
}
const grandparent: Record<string, unknown> = { old: 1 };
const parent: Record<string, unknown> = Object.create(grandparent);
parent.inherited = 1;
const small: Record<string, unknown> = Object.create(parent);
small.a = 1;
small.b = 2;
const twin: Record<string, unknown> = Object.create(parent);
twin.a = 1;
twin.b = 2;
lines.push("nothing yet: " + ask(small, 5) + " | " + ask(twin, 5));
small[sameText(0)] = "own";
lines.push("one on the object: " + ask(small, 5) + " | the twin " + ask(twin, 5));
parent[sameText(1)] = "above";
lines.push("one on the parent: " + ask(small, 5) + " | " + ask(twin, 5));
grandparent[sameText(2)] = "top";
lines.push("one on the grandparent: " + ask(small, 5) + " | " + ask(twin, 5) + " | " + ask({}, 5));
delete grandparent[sameText(2)];
delete parent[sameText(1)];
lines.push("both gone: " + ask(small, 5) + " | " + ask(twin, 5) + " | " + ask({}, 5));
Object.defineProperty(parent, sameText(3), { get() { return "got"; }, configurable: true });
lines.push("a getter above: " + ask(small, 5) + " | " + ask(twin, 5));
delete parent[sameText(3)];
Object.setPrototypeOf(twin, { [sameText(4)]: "other parent" });
lines.push("another parent: " + ask(small, 5) + " | " + ask(twin, 5));

const large: Record<string, unknown> = {};
for (let i = 0; i < 200; i++) large["key" + i] = i;
lines.push("a dictionary: " + ask(large, 5));
large[sameText(5)] = "in";
lines.push("it has one: " + ask(large, 5));
delete large[sameText(5)];
lines.push("no longer: " + ask(large, 5));
delete large.key7;
large[sameText(0)] = "for another";
lines.push("one out, one in: " + ask(large, 5));
delete large[sameText(0)];
large.key7 = 7;
lines.push("and back: " + ask(large, 5));

const list: any = [1, 2, 3];
function callable() { }
lines.push("an array, a function: " + ask(list, 4) + " | " + ask(callable as any, 4));
list[sameText(1)] = "on the array";
(callable as any)[sameText(2)] = "on the function";
lines.push("then: " + ask(list, 4) + " | " + ask(callable as any, 4));
const watched = new Proxy({}, { get(_target, name) { return typeof name === "string" && name.endsWith("SIX") ? "trapped" : undefined; } });
const belowProxy: Record<string, unknown> = Object.create(watched);
lines.push("below a proxy: " + ask(belowProxy, 4));
const bare: Record<string, unknown> = Object.create(null);
lines.push("no parent at all: " + ask(bare, 4));
bare[sameText(3)] = "bare";
lines.push("then: " + ask(bare, 4));
let total = 0;
for (let turn = 0; turn < 20000; turn++) {
    if (turn === 9000) parent[sameText(5)] = 1;
    if (turn === 15000) delete parent[sameText(5)];
    if (small[asked[turn % 6]!] !== undefined) total++;
}
lines.push("in a long loop: " + total);
console.log(lines.join("\n"));
