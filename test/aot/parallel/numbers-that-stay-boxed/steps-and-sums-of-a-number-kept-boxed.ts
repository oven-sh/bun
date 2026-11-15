// A number that lies boxed in a captured variable or in a field is stepped or added to and stored boxed again. Int32s are added as int32s: every edge of that is walked here.
function show(value: unknown): string {
    return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
}

function makeCounter(start: number) {
    let position: number = start;
    return {
        up() { position++; return position; },
        down() { position--; return position; },
        upFirst() { return ++position; },
        downFirst() { return --position; },
        upOld() { return position++; },
        downOld() { return position--; },
        two() { position += 2; return position; },
        lessTwo() { position -= 2; return position; },
        many() { position += 2147483647; return position; },
        lessMany() { position -= 2147483647; return position; },
        by(step: number) { position += step; return position; },
        less(step: number) { position -= step; return position; },
        from(step: number) { position = step - position; return position; },
        read() { return position; },
        set(value: number) { position = value; },
    };
}

class Cursor {
    at: number;
    constructor(at: number) { this.at = at; }
    up() { this.at++; return this.at; }
    down() { this.at--; return this.at; }
    by(step: number) { this.at += step; return this.at; }
    less(step: number) { this.at -= step; return this.at; }
}

const starts: number[] = [0, 1, -1, 7, 2147483645, 2147483646, 2147483647, -2147483646, -2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 0.5, -0.5, 1.5, -0, NaN, Infinity, -Infinity,
    9007199254740990, 9007199254740991, 9007199254740992, -9007199254740992, 1e308, -1e308, 5e-324, 2147483646.5, -2147483648.5];
const steps: number[] = [0, 1, -1, 2147483647, -2147483648, 0.5, -0, NaN, Infinity, 1e308, 4294967296];

for (const start of starts) {
    const line: string[] = [show(start)];
    for (const name of ["up", "down", "upFirst", "downFirst", "upOld", "downOld", "two", "lessTwo", "many", "lessMany"] as const) {
        const counter = makeCounter(start);
        line.push(name + "=" + show(counter[name]()) + "," + show(counter.read()) + "," + show(counter[name]()) + "," + show(counter[name]()));
    }
    console.log(line.join(" "));
    for (const step of steps) {
        const counter = makeCounter(start);
        const cursor = new Cursor(start);
        console.log("  ", show(step), show(counter.by(step)), show(counter.less(step)), show(counter.less(step)), show(counter.from(step)), show(cursor.by(step)), show(cursor.less(step)), show(cursor.up()), show(cursor.down()), show(cursor.down()));
    }
}

// What is written a number and is none.
const liar = makeCounter("12" as unknown as number);
console.log(show(liar.two()), show(liar.up()), show(liar.read()));
const other = makeCounter(10n as unknown as number);
console.log(show(other.up()), show(other.down()), show(other.downFirst()));
const nothing = makeCounter(undefined as unknown as number);
console.log(show(nothing.up()), show(nothing.two()));
const object = makeCounter({ valueOf() { return 41; } } as unknown as number);
console.log(show(object.up()), show(object.lessTwo()));

let total: number = 0;
function count(limit: number) {
    let position: number = 2147483600;
    const advance = () => { position++; total += 3; };
    for (let turn = 0; turn < limit; ++turn)
        advance();
    return position;
}
console.log(show(count(100)), show(total));
