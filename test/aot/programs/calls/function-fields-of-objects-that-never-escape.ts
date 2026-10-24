// An object that never leaves the function that makes it holds a function in a field, and the field is called where the code is hot.
// Each part has types of its own, so that what one part stores decides nothing for the next.
const lines: string[] = [];
function say(label: string, ...parts: unknown[]): void { lines.push(label + ": " + parts.join(" ")); }
interface Point { x: number; y: number }
const made: Point = { x: 1, y: 2 };
let noted = 0;

class Walker {
    seen = 0;
    constructor(public onEach: (p: Point) => void) {}
}
for (let round = 0; round < 3; round++) {
    const walker = new Walker(p => { noted += p.y; });
    walker.onEach(made);
    say("the function the constructor got", walker.seen, noted);
    walker.onEach = function (this: unknown, p: Point) { (this as Walker).seen += p.x; };
    walker.onEach(made);
    say("the function assigned later", walker.seen, noted);
}

class Stepper {
    seen = 0;
    constructor(public onStep: (p: Point) => void) {}
    step(p: Point): number { this.onStep(p); return this.seen; }
}
function throughAMethod(rounds: number, p: Point): string {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        const stepper = new Stepper(q => { noted += q.y * 10; });
        total += stepper.step(p);
        stepper.onStep = function (this: unknown, q: Point) { (this as Stepper).seen += q.x; };
        total += stepper.step(p) * 100;
    }
    return total + " " + noted;
}
say("through a method", throughAMethod(3, made), throughAMethod(0, made));

class Reader {
    seen = 0;
    constructor(public onRead: (p: Point) => void) {}
}
function neverRead(rounds: number, p: Point): string {
    let last = 0;
    for (let round = 0; round < rounds; round++) {
        const unread = new Reader(q => { noted += q.y * 1000; });
        unread.seen = round;
        const reader = new Reader(function (this: unknown, q: Point) { (this as Reader).seen += q.x; });
        reader.onRead(p);
        last = reader.seen;
    }
    return last + " " + noted;
}
say("beside an object that is only written", neverRead(3, made));

interface Holder { scale: number; apply: (x: number) => number }
function double(x: number): number { return x * 2; }
function records(rounds: number): number {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        const first: Holder = { scale: round, apply: double };
        total += first.apply(round);
        const second: Holder = { scale: round, apply: x => x + 100 };
        total += second.apply(round);
        second.apply = double;
        total += second.apply(round);
    }
    return total;
}
say("records", records(4));

class Counter {
    count = 0;
    bump = () => { this.count++; return this.count; };
}
function arrows(rounds: number): number {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        const a = new Counter(), b = new Counter();
        total += a.bump() + a.bump();
        b.bump = a.bump;
        total += b.bump() * 10 + b.count * 100 + a.count * 1000;
        b.bump = () => -1;
        total += b.bump();
    }
    return total;
}
say("arrow functions that capture their holder", arrows(3));

class Escapee {
    seen = 0;
    constructor(public onLeave: (p: Point) => void) {}
}
const kept: Escapee[] = [];
function escaping(rounds: number, p: Point): string {
    for (let round = 0; round < rounds; round++) {
        const escapee = new Escapee(q => { noted += q.y * 100000; });
        if (round === 1) kept.push(escapee);
        escapee.onLeave(p);
        escapee.onLeave = function (this: unknown, q: Point) { (this as Escapee).seen += q.x; };
        escapee.onLeave(p);
    }
    return kept.map(escapee => escapee.seen).join() + " " + noted;
}
say("an object that leaves on one path", escaping(3, made));
console.log(lines.join("\n"));
