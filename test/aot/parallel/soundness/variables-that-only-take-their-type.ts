// Variables that a group of closures shares, and variables of the module, whose every store names them.
// What is stored fits their types as long as the other typed places hold theirs, so a read needs no test. One store of a value out of `any` takes that away, for the variable and for whatever is fed from it.
function createScanner(text: string) {
    var pos: number;
    var end: number;
    let flags: number = 0;
    let token: string = "";
    let loose: number = 0;

    function reset(position: number, length: number) {
        pos = position;
        end = position + length;
        flags = 0;
    }
    function lookAhead<T>(callback: () => T): T {
        const savedPos = pos;
        const savedFlags = flags;
        const savedToken = token;
        const result = callback();
        pos = savedPos;
        flags = savedFlags;
        token = savedToken;
        return result;
    }
    function scan(): number {
        while (pos < end && text.charCodeAt(pos) === 32) pos++;
        if (pos >= end) return -1;
        const start = pos;
        while (pos < end && text.charCodeAt(pos) !== 32) pos++;
        token = text.substring(start, pos);
        flags |= token.length & 7;
        return pos - start;
    }
    function takeLoose(value: any) {
        loose = value;
    }
    // Before anybody else can call a thing: nobody sees what `pos` and `end` start as.
    reset(0, text.length);
    return { reset, lookAhead, scan, takeLoose, token: () => token, flags: () => flags, pos: () => pos, loose: () => loose };
}

// The same text once more: whatever is done to these variables below says nothing of the ones above.
function createSpoiledScanner(text: string) {
    var pos: number;
    var end: number;
    let flags: number = 0;
    let token: string = "";
    let loose: number = 0;

    function reset(position: number, length: number) {
        pos = position;
        end = position + length;
        flags = 0;
    }
    function lookAhead<T>(callback: () => T): T {
        const savedPos = pos;
        const savedFlags = flags;
        const savedToken = token;
        const result = callback();
        pos = savedPos;
        flags = savedFlags;
        token = savedToken;
        return result;
    }
    function scan(): number {
        while (pos < end && text.charCodeAt(pos) === 32) pos++;
        if (pos >= end) return -1;
        const start = pos;
        while (pos < end && text.charCodeAt(pos) !== 32) pos++;
        token = text.substring(start, pos);
        flags |= token.length & 7;
        return pos - start;
    }
    function takeLoose(value: any) {
        loose = value;
    }
    return { reset, lookAhead, scan, takeLoose, token: () => token, flags: () => flags, pos: () => pos, loose: () => loose };
}

let total: number = 0;
let rounds: number = 0;
let label: string = "none";
var last: number;

function count(words: string) {
    const scanner = createScanner(words);
    scanner.reset(0, words.length);
    let length: number;
    while ((length = scanner.scan()) >= 0) {
        total += length;
        last = length;
        label = scanner.token();
    }
    rounds++;
    return scanner.flags();
}

const lines = ["the quick brown fox", "jumps over", "", "   the lazy   dog ", "-0 NaN 2147483648 9007199254740993"];
let bits = 0;
for (let round = 0; round < 3; round++)
    for (const line of lines) bits = (bits * 31 + count(line)) | 0;
console.log(total, rounds, label, last!, bits);

const peeking = createScanner("one two three");
peeking.reset(0, 13);
console.log(peeking.lookAhead(() => [peeking.scan(), peeking.scan(), peeking.token()].join()), peeking.pos(), peeking.flags(), JSON.stringify(peeking.token()));
console.log(peeking.scan(), peeking.token(), peeking.pos(), peeking.flags());

// Positions that are no int32, and none at all.
const odd = createSpoiledScanner("a b");
odd.reset(-0, 3);
console.log(Object.is(odd.pos(), -0), odd.scan(), odd.pos());
odd.reset(0.5, 2);
console.log(odd.pos(), odd.scan(), odd.pos());
odd.reset(NaN, 1);
console.log(odd.pos(), odd.scan(), odd.pos());
odd.reset(2147483647, 2);
console.log(odd.pos(), odd.scan(), odd.pos());
odd.reset(9007199254740992, 1);
console.log(odd.pos(), odd.scan());

// Read before any store: undefined, whatever the type says.
const fresh = createSpoiledScanner("x");
console.log(fresh.pos(), typeof fresh.pos(), fresh.flags(), fresh.scan());

// What does not fit comes in through `any`.
const spoiled = createSpoiledScanner("x y");
spoiled.takeLoose("text");
console.log(spoiled.loose(), typeof spoiled.loose());
spoiled.takeLoose(undefined);
console.log(spoiled.loose(), typeof spoiled.loose());
spoiled.takeLoose(7);
console.log(spoiled.loose() + 1);
(spoiled.reset as any)("1", "2");
console.log(spoiled.pos(), typeof spoiled.pos(), spoiled.scan(), spoiled.pos());
(spoiled.reset as any)();
console.log(spoiled.pos(), spoiled.scan(), spoiled.flags());

// A variable that is saved and restored: what it starts as is never read, though what is read from it is stored back.
function createWalker(start: number) {
    var context: number;
    var cleared: number;
    var fed: number;
    context = start;
    cleared = start;
    fed = start;
    function inside<T>(flag: number, callback: () => T): T {
        const saved = context;
        context |= flag;
        const result = callback();
        context = saved;
        return result;
    }
    function clear() {
        fed = cleared;
        cleared = undefined!;
    }
    return { inside, clear, context: () => context, cleared: () => cleared, fed: () => fed };
}
const walker = createWalker(1);
console.log(walker.inside(4, () => walker.inside(8, () => walker.context()) + walker.context()), walker.context());
walker.clear();
console.log(walker.cleared(), walker.fed(), typeof walker.cleared());
walker.clear();
console.log(walker.cleared(), walker.fed(), typeof walker.fed());
for (const start of [-0, 0.5, NaN, 2147483648, -2147483649, 9007199254740993]) {
    const other = createWalker(start);
    console.log(Object.is(other.context(), start), other.inside(1, () => other.context()), other.context());
}
try {
    walker.inside(16, () => { throw new Error("left inside"); });
} catch (error) {
    console.log((error as Error).message, walker.context());
}
