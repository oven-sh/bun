// A loop reads and writes variables that live outside its function: in an enclosing function or in the module.
// Whatever else can see such a variable (a callee, a getter, valueOf, a handler, a generator's caller) has to find what the loop stored last,
// and the loop has to find what they stored.
const lines: string[] = [];
function say(name: string, ...values: unknown[]): void {
    lines.push(name + ": " + values.map(value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value))).join(" "));
}
const opaque = new Function("value", "return value") as <T>(value: T) => T;

function makeScanner(initial: string) {
    let text: string = initial;
    let pos: number = 0;
    let end: number = text.length;
    let resets = 0;
    function isLetter(code: number): boolean { return code >= 97 && code <= 122; }
    function word(): number { const start = pos; while (pos < end && isLetter(text.charCodeAt(pos))) pos++; return pos - start; }
    function gap(): number { const start = pos; while (pos < end && !isLetter(text.charCodeAt(pos))) pos++; return pos - start; }
    function wordWithRareReset(limit: number): number {
        let turns = 0;
        while (pos < end && isLetter(text.charCodeAt(pos))) {
            pos++;
            if (++turns === limit) reset();
        }
        return turns;
    }
    function reset(): void { resets++; pos = end - 2; }
    function wordThatThrowsAt(stop: number): number {
        while (pos < end) {
            if (pos === stop) throw new RangeError("stopped");
            pos++;
        }
        return pos;
    }
    function shrinkingEnd(): number { let turns = 0; while (pos < end) { pos++; end--; turns++; } return turns; }
    function replaceTextInLoop(other: string): string {
        let seen = "";
        while (pos < end) {
            seen += text[pos];
            if (pos === 1) { text = other; end = other.length; }
            pos++;
        }
        return seen;
    }
    return {
        word, gap, wordWithRareReset, wordThatThrowsAt, shrinkingEnd, replaceTextInLoop,
        set(p: number): void { pos = p; },
        setAny(p: any): void { pos = p; },
        setEndAny(e: any): void { end = e; },
        setTextAny(t: any): void { text = t; },
        state(): string { return String(pos) + "|" + String(end) + "|" + String(text) + "|" + resets; },
    };
}

{
    const scanner = makeScanner("alpha  beta gamma");
    say("words", scanner.word(), scanner.gap(), scanner.word(), scanner.gap(), scanner.word(), scanner.gap(), scanner.state());
    scanner.set(0);
    say("rare reset", scanner.wordWithRareReset(3), scanner.state());
    scanner.set(0);
    try { scanner.wordThatThrowsAt(7); } catch (error) { say("thrown", (error as Error).message, scanner.state()); }
    scanner.set(2);
    say("shrinking end", scanner.shrinkingEnd(), scanner.state());
    const replaced = makeScanner("abcdef");
    say("text replaced", replaced.replaceTextInLoop("uvwxyz0123"), replaced.state());
}

for (const start of [0.5, -0, NaN, 2147483640, -2147483650, 9007199254740990, Infinity, "3", null, undefined, true, 2n, { valueOf() { return 4; } }]) {
    const scanner = makeScanner("abcdefgh ijk");
    scanner.setAny(opaque(start));
    let result: unknown;
    try { result = scanner.word(); } catch (error) { result = (error as Error).name; }
    say("odd start", start === null || typeof start !== "object" ? start : "object", result, scanner.state());
}
for (const limit of [3.5, -0, NaN, 2147483648, "5", null, undefined, 6n, { valueOf() { return 2; } }]) {
    const scanner = makeScanner("abcdefgh ijk");
    scanner.setEndAny(opaque(limit));
    let result: unknown;
    try { result = scanner.word(); } catch (error) { result = (error as Error).name; }
    say("odd end", limit === null || typeof limit !== "object" ? limit : "object", result, scanner.state());
}
for (const odd of [null, undefined, 12345, ["a", "b"], { charCodeAt() { return 100; }, toString() { return "object"; } }]) {
    const scanner = makeScanner("abcdefgh ijk");
    scanner.setTextAny(opaque(odd));
    let result: unknown;
    try { result = scanner.word(); } catch (error) { result = (error as Error).name; }
    say("odd text", result, scanner.state());
}

function overflowing() {
    let counter: number = 2147483640;
    let sum = 0;
    function run(turns: number): void { for (let i = 0; i < turns; i++) { counter++; sum += counter % 7; } }
    function down(turns: number): void { for (let i = 0; i < turns; i++) { counter -= 3; sum += counter % 5; } }
    return { run, down, read: () => counter + "|" + sum, put(value: number): void { counter = value; } };
}
{
    const numbers = overflowing();
    numbers.run(20); say("past 2^31", numbers.read());
    numbers.put(-2147483640); numbers.down(10); say("below -2^31", numbers.read());
    numbers.put(9007199254740985); numbers.run(12); say("past 2^53", numbers.read());
    numbers.put(0.25); numbers.run(3); say("fractions", numbers.read());
    numbers.put(-1); numbers.run(1); say("to zero", numbers.read());
}

function observers() {
    let level: number = 0;
    const seen: number[] = [];
    const watcher = { valueOf(): number { seen.push(level); if (level === 3) level = 10; return 12; } };
    const holder = { get limit(): number { seen.push(-level); return level < 6 ? 8 : 0; } };
    function againstValueOf(bound: any): number { let turns = 0; while (level < bound) { level++; turns++; } return turns; }
    function againstGetter(object: { limit: number }): number { let turns = 0; while (level < object.limit) { level += 2; turns++; } return turns; }
    return { run1: () => againstValueOf(watcher), run2: () => againstGetter(holder), clear(): void { level = 0; seen.length = 0; }, read: () => level + "|" + seen.join(",") };
}
{
    const watched = observers();
    say("valueOf writes", watched.run1(), watched.read());
    watched.clear();
    say("getter reads", watched.run2(), watched.read());
}

function nested() {
    let row: number = 0;
    let column: number = 0;
    let cells = 0;
    function walk(rows: number, columns: number): void {
        for (row = 0; row < rows; row++) {
            for (column = 0; column < columns; column++) {
                cells += row * 10 + column;
                if (column === row) continue;
                if (column > row + 2) break;
            }
        }
    }
    function labelled(rows: number): void {
        outer: while (row > 0) {
            row--;
            column = rows;
            while (column > 0) {
                column--;
                if (column === row) continue outer;
                if (row === 1) break outer;
                cells++;
            }
        }
    }
    return { walk, labelled, read: () => row + "|" + column + "|" + cells };
}
{
    const grid = nested();
    grid.walk(5, 7); say("nested", grid.read());
    grid.labelled(4); say("labelled", grid.read());
}

let moduleIndex: number = 0;
let moduleTotal: number = 0;
let moduleText: string = "module level text";
function bumpModuleIndex(): void { moduleIndex += 3; }
function moduleLoop(limit: number): number {
    let turns = 0;
    while (moduleIndex < limit) {
        moduleTotal += moduleText.charCodeAt(moduleIndex % moduleText.length);
        moduleIndex++;
        if (moduleIndex % 8 === 0) bumpModuleIndex();
        turns++;
    }
    return turns;
}
say("module variables", moduleLoop(40), moduleIndex, moduleTotal);
moduleIndex = opaque(5); moduleText = opaque("other");
say("module variables again", moduleLoop(12), moduleIndex, moduleTotal);

function finallyAndCatch() {
    let step: number = 0;
    const log: string[] = [];
    function run(): void {
        while (step < 9) {
            try {
                step++;
                if (step % 3 === 0) throw new Error("e" + step);
                if (step === 7) continue;
                log.push("t" + step);
            } catch (error) {
                log.push((error as Error).message + "@" + step);
                step++;
            } finally {
                log.push("f" + step);
            }
        }
    }
    return { run, read: () => step + "|" + log.join(",") };
}
{
    const handled = finallyAndCatch();
    handled.run(); say("handlers", handled.read());
}

function suspended() {
    let cursor: number = 0;
    function* numbers(limit: number): Generator<number, string, void> { while (cursor < limit) { yield cursor; cursor++; } return "end" + cursor; }
    async function slowly(limit: number): Promise<number> { let turns = 0; while (cursor < limit) { cursor++; await null; turns++; } return turns; }
    return { numbers, slowly, jump(by: number): void { cursor += by; }, read: () => cursor };
}
{
    const paused = suspended();
    const got: unknown[] = [];
    const iterator = paused.numbers(10);
    for (let next = iterator.next(); ; next = iterator.next()) {
        got.push(next.value);
        if (next.done) break;
        if (next.value === 2) paused.jump(4);
    }
    say("generator", got.join(","), paused.read());
}

function deadZone() {
    function early(): number { let turns = 0; while (late < 3) { late++; turns++; } return turns; }
    let result: unknown;
    try { result = early(); } catch (error) { result = (error as Error).name; }
    let late: number = 1;
    return [result, early(), late];
}
say("dead zone", ...deadZone());

function twoOfOneKind() {
    const first = makeCounter(), second = makeCounter();
    function makeCounter() {
        let value: number = 0;
        return {
            raceAgainst(other: { bump(): void; read(): number }, limit: number): number { let turns = 0; while (value < limit) { value++; other.bump(); turns++; } return turns; },
            bump(): void { value += 2; },
            read(): number { return value; },
        };
    }
    return [first.raceAgainst(second, 5), first.read(), second.read(), first.raceAgainst(first, 20), first.read()];
}
say("two environments of one kind", ...twoOfOneKind());

function neverEntered() {
    let untouched: number = 7;
    function run(limit: number): number { let turns = 0; while (untouched < limit) { untouched++; turns++; } return turns; }
    return [run(7), untouched, run(-1), untouched];
}
say("no turn", ...neverEntered());

function changesKind() {
    let shifting: any = 0;
    function run(): string { let trail = ""; while (shifting < 6 || shifting.length < 4) { trail += typeof shifting + ";"; shifting = shifting === 2 ? "2" : shifting + 1; if (trail.length > 90) break; } return trail; }
    return [run(), shifting];
}
say("a number becomes a string", ...changesKind());

function callsOnOneArm() {
    let cursor: number = 0;
    let limit: number = 40;
    let calls = 0;
    function skip(by: number): boolean { calls++; cursor += by; if (calls === 3) limit -= 5; return calls % 2 === 0; }
    function run(text: string): string {
        let trail = "";
        while (cursor < limit) {
            const code = text.charCodeAt(cursor % text.length);
            if (code > 110 && skip(code - 110)) trail += "!";
            trail += cursor + ",";
            cursor++;
        }
        return trail;
    }
    return [run("abcxyzdefpq"), cursor, limit, calls];
}
say("a call on one arm writes", ...callsOnOneArm());

function readThroughAnotherClosure() {
    let at: number = 0;
    let source: string = "one two  three";
    function current(): number { return source.charCodeAt(at); }
    function isSpace(): boolean { return current() === 32; }
    function skipSpaces(): number { let turns = 0; while (at < source.length && isSpace()) { at++; turns++; } return turns; }
    function skipWord(): number { let turns = 0; while (at < source.length && !isSpace()) { at++; turns++; } return turns; }
    const counts: number[] = [];
    while (at < source.length) { counts.push(skipWord(), skipSpaces()); if (counts.length === 4) source += " four"; }
    return [counts.join(","), at, source];
}
say("read through another closure", ...readThroughAnotherClosure());

function leavesTheIntegers() {
    let big: number = 2147483644;
    let half: number = 0;
    function up(limit: number): number { let turns = 0; while (big < limit) { big++; turns++; } return turns; }
    function byHalves(limit: number): number { let turns = 0; while (half < limit) { half += turns === 3 ? 0.5 : 1; turns++; } return turns; }
    return [up(2147483652), big, up(2147483655), big, byHalves(7), half];
}
say("leaves the integers in the loop", ...leavesTheIntegers());

function someTurnsDoNotStore() {
    let seen: number = 0;
    let index: number = 0;
    function run(values: number[]): number {
        let turns = 0;
        while (index < values.length) {
            turns++;
            if (values[index++] % 3 === 0) continue;
            seen += index;
        }
        return turns;
    }
    return [run([1, 3, 4, 6, 9, 10, 11]), seen, index];
}
say("some turns do not store", ...someTurnsDoNotStore());

function leavesBehindAStore() {
    let at: number = 0;
    let found = 0;
    const where = (): number => at;
    function find(text: string, code: number): boolean {
        while (at < text.length) {
            const c = text.charCodeAt(at);
            at++;
            if (c === code) { found++; return true; }
        }
        return false;
    }
    function untilItThrows(text: string, holder: { inner: { stop: number } | null }): number {
        let turns = 0;
        while (at < text.length) {
            at++;
            turns++;
            if (text.charCodeAt(at) === 46) holder.inner = null;
            if (holder.inner!.stop === at) break;
        }
        return turns;
    }
    const trail: unknown[] = [];
    const text = "ab,cd,,e.fgh";
    while (find(text, 44)) trail.push(where());
    trail.push(where(), found);
    at = 0;
    trail.push(untilItThrows(text, { inner: { stop: 3 } }), where());
    try { untilItThrows(text, { inner: { stop: 99 } }); } catch (error) { trail.push((error as Error).name, where()); }
    return trail;
}
say("leaves behind a store", ...leavesBehindAStore());

function growsItsArray() {
    let points = new Int32Array(2);
    let length: number = 0;
    function add(parts: number[]): void {
        for (const part of parts) {
            if (length === points.length) { const roomier = new Int32Array(points.length * 2); roomier.set(points); points = roomier; }
            points[length++] = part;
        }
    }
    add([5, 6, 7]); add([]); add([8, 9, 10, 11, 12, 13]);
    return [length, points.length, Array.from(points).join(",")];
}
say("the array itself is replaced in the loop", ...growsItsArray());

const names: (string | number)[] = ["a", "b", 0, "length", "zz"];
function asksEveryName(object: any): number { let count = 0; for (let round = 0; round < 3; round++) for (const name of names) count += name in object ? 1 : 0; return count; }
say("a loop inside runs other code", asksEveryName({ a: 1, zz: 2 }), asksEveryName([7]), asksEveryName(new Proxy({}, { has(_, key) { if (key === "b") names.push("a"); return key === "a"; } })), names.length);

function readsARope() {
    let at: number = 0;
    let stops = 0;
    const where = (): number => at;
    function untilMark(text: string): number { let turns = 0; while (true) { at++; turns++; if (at >= text.length || text.charCodeAt(at) === 33) { stops++; break; } } return turns; }
    const trail: unknown[] = [];
    for (const tail of ["!", "xyz!", ""]) {
        const rope = opaque("left half, ") + opaque("right half") + tail;
        at = 0;
        trail.push(untilMark(rope), where());
    }
    return [...trail, stops];
}
say("a rope is resolved in the loop", ...readsARope());

const paused = suspended();
paused.slowly(6).then(turns => {
    say("async", turns, paused.read());
    console.log(lines.join("\n"));
});
paused.jump(2);
