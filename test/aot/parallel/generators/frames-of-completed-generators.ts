// Generators that complete, are left, throw and are kept: the frame of one that has completed is the frame of the next.
// Env: BUN_JSC_slowPathAllocsBetweenGCs=3
function* pair(a: number, b: number): Generator<number> { yield a; yield b; }
function* swapped(a: number, b: number): Generator<number> { yield b; yield a; }
function* texts(prefix: string, count: number): Generator<string> { for (let i = 0; i < count; ++i) yield prefix + i; }
function* guarded(log: string[], value: number): Generator<number> { try { yield value; yield value + 1; } finally { log.push("closed " + value); } }
function* outer(depth: number): Generator<number> { yield depth; if (depth > 0) yield* outer(depth - 1); yield -depth; }
function* objects(list: { id: number }[]): Generator<{ id: number }> { for (const each of list) { const made = { id: each.id * 2 }; yield made; yield each; } }
function* failing(value: number): Generator<number> { yield value; throw new Error("failed at " + value); }
function* never(): Generator<number> { if (Math.random() < 0) yield 1; }

function firstOf<T>(iterable: Iterable<T>): T | undefined { for (const value of iterable) return value; return undefined; }
function sumOf(iterable: Iterable<number>): number { let sum = 0; for (const value of iterable) sum += value; return sum; }

const collect = () => { if (typeof Bun !== "undefined") Bun.gc(true); };
const lines: string[] = [];
for (let round = 0; round < 60; ++round) {
    const log: string[] = [];
    let sum = 0;
    for (let i = 0; i < 40; ++i) {
        sum += sumOf(pair(i, round)) * 3 + sumOf(swapped(i, 2 * round));
        sum += firstOf(pair(i, 7))! + firstOf(guarded(log, i))!;
        sum += firstOf(never()) ?? 1;
        for (const x of pair(i, 1)) for (const y of swapped(x, 2)) { sum += x * y; for (const z of pair(y, x)) sum -= z; }
        if (i % 13 === round % 13) collect();
    }
    const kept = pair(round, 5);
    const first = kept.next().value;
    const other = swapped(1, 2);
    const ended = pair(3, 4);
    ended.next(); ended.next();
    const last = ended.next();
    const again = ended.next();
    const after = [...pair(8, 9)];
    const rest = [...kept];
    lines.push([sum, log.length, log[log.length - 1], first, last.done, again.done, after.join("+"), rest.join("+"), [...other].join("+"), [...outer(4)].join(",")].join(" | "));
    const ids = [];
    for (const object of objects([{ id: round }, { id: round + 1 }])) { ids.push(object.id); if (ids.length === 3) collect(); }
    lines.push(ids.join(",") + " " + [...texts("t" + round + "-", round % 5)].join(" "));
    try { sumOf(failing(round)); } catch (error) { lines.push((error as Error).message); }
    const interrupted = failing(round);
    interrupted.next();
    const returned = interrupted.return(11);
    lines.push(returned.value + " " + returned.done + " " + firstOf(failing(2)));
}
let hash = 0;
for (const line of lines) for (let i = 0; i < line.length; ++i) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(lines[0], lines[1], lines[2], lines[3]);
console.log(lines[lines.length - 4], lines[lines.length - 3], lines[lines.length - 2], lines[lines.length - 1]);
console.log(lines.length, hash);
