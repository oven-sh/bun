// The kin of an older fault (a typed store that lays undefined in a raw slot sets the mark where it runs) for STORES that go by the mark: the deed and the next store stand in one function:
// the crate comes off a shelf of which nothing is written, so that it is only expected to be a Crate and is tested where it is used:
// straight behind, behind a join, at a loop's head, under another name, and with the source of a copy. What is seen: the values, the holes counted, the keys.
const enum Tint { None, Red, Gold, Blue }
class Crate {
    tint: Tint; weight: number; open: boolean;
    constructor(seed: number) { this.tint = (seed & 3) as Tint; this.weight = seed * 2; this.open = (seed & 1) === 1; }
}
function straight(shelf: any, i: number): string {
    const crate = shelf.it;
    crate.tint = ((i & 2) ? Tint.Gold : undefined) as Tint;
    crate.weight = i;
    crate.tint = ((i & 4) ? Tint.Blue : crate.tint) as Tint;
    crate.open = ((i & 1) ? undefined : true) as boolean;
    return crate.tint + " " + crate.weight + " " + crate.open;
}
function behindJoin(shelf: any, i: number): string {
    const crate = shelf.it;
    if (i & 1) crate.tint = ((i & 2) ? Tint.Gold : undefined) as Tint;
    crate.weight = i + 1;
    crate.open = (i & 4) === 4;
    const seen = crate.tint;
    crate.tint = (seen === undefined ? Tint.Red : seen) as Tint;
    return seen + " " + crate.tint + " " + crate.weight + " " + crate.open;
}
function inLoop(shelf: any, turns: number): string {
    const crate = shelf.it;
    let holes = 0, sum = 0;
    for (let i = 0; i < turns; i++) {
        const seen = crate.tint;
        if (seen === undefined) holes++; else sum += seen;
        crate.weight = sum;
        crate.tint = ((i % 3) ? (i & 3) : undefined) as Tint;
        crate.open = (i & 1) === 0;
    }
    return holes + " " + sum + " " + crate.tint + " " + crate.weight + " " + crate.open;
}
function twoNames(shelf: any, i: number): string {
    const one = shelf.it, other = shelf.from;
    one.tint = ((i & 1) ? undefined : Tint.Blue) as Tint;
    other.weight = one.weight + 1;
    other.tint = one.tint;
    other.open = one.open;
    one.weight = other.weight + 1;
    return one.tint + " " + one.weight + " " + other.tint + " " + other.weight + " " + other.open;
}
class Shelf { it: unknown; from: unknown; constructor(it: unknown, from: unknown) { this.it = it; this.from = from; } }
function make(seed: number): Crate { return new Crate(seed); }
function shelve(it: unknown, from: unknown): Shelf { return new Shelf(it, from); }
console.log(new Function("make", "shelve", "straight", "behindJoin", "inLoop", "twoNames", `
    const lines = [];
    for (let i = 0; i < 48; i++) {
        const crate = make(i), shelf = shelve(crate, null);
        lines.push(straight(shelf, i) + " | " + behindJoin(shelf, i) + " | " + inLoop(shelf, (i & 7) + 3) + " | " + twoNames(shelve(crate, make(i + 1)), i) + " | " + twoNames(shelve(crate, crate), i)
            + " | " + Object.keys(crate).join() + " " + JSON.stringify(crate));
    }
    return lines.join("\\n");
`)(make, shelve, straight, behindJoin, inLoop, twoNames));
