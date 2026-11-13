// Branches on values of every kind, in loops and outside, on tests that meet in a join, and on the equality of two values.
interface Thing { kind: number; flags: number; next?: Thing; text?: string; }
const enum Kind { First = 1, Second = 2, Third = 3, Fourth = 4 }
const enum Flags { None = 0, Odd = 1, Large = 2, Named = 4 }

const empty = "";
const wide = "Ж".repeat(3);
const values: any[] = [undefined, null, false, true, 0, 1, -1, -0, 0.5, NaN, Infinity, "", empty, "a", "ab".slice(1), "ab".slice(2), wide, 0n, 1n, -1n, Symbol.for("s"), {}, [], () => 1, new Date(0), /r/, new Map()];

function truthOutside(value: any): string { return value ? "yes" : "no"; }
function notOutside(value: any): string { return !value ? "no" : "yes"; }
function chooseFirst(value: any, other: any): any { return value || other; }
function chooseLast(value: any, other: any): any { return value && other; }
function truthOfThing(value: Thing | undefined): number { return value ? value.kind : 0; }
function truthOfText(value: string | undefined): number { return value ? value.length : -1; }

function truthInLoop(list: any[]): number {
    let count = 0;
    for (let i = 0; i < list.length; i++) {
        if (list[i])
            count += i + 1;
        else if (!list[i])
            count -= 1;
    }
    return count;
}
function ofKind(thing: Thing): number { return thing.kind; }
function isFirstOrSecond(thing: Thing): boolean { return thing.kind === Kind.First || thing.kind === Kind.Second; }
function isNamed(thing: Thing): boolean { return (thing.flags & Flags.Named) !== 0; }
function isOdd(thing: Thing): boolean { return !!(thing.flags & Flags.Odd); }
function isLargeOrFourth(thing: Thing): boolean { return isLarge(thing) || ofKind(thing) === Kind.Fourth; }
function isLarge(thing: Thing): boolean { return !!(thing.flags & Flags.Large); }

function joinedTests(thing: Thing): string {
    let answer = "";
    if (isFirstOrSecond(thing)) answer += "A";
    if (!isFirstOrSecond(thing)) answer += "B";
    if (isOdd(thing) && isFirstOrSecond(thing)) answer += "C";
    if (isOdd(thing) || isFirstOrSecond(thing)) answer += "D";
    if (isLargeOrFourth(thing)) answer += "E";
    if (isNamed(thing) && !isLargeOrFourth(thing)) answer += "F";
    const test = thing.kind === Kind.Third || isOdd(thing);
    if (test) answer += "G";
    if (!test) answer += "H";
    const never = isOdd(thing) ? false : thing.kind === Kind.Third;
    if (never) answer += "I";
    const always = isOdd(thing) ? true : thing.kind === Kind.Third;
    if (always) answer += "J";
    return answer;
}
function joinedTestsInLoop(list: Thing[]): string {
    let answer = "";
    for (const thing of list) {
        let current: Thing | undefined = thing;
        while (current && !isFirstOrSecond(current) && !isLargeOrFourth(current))
            current = current.next;
        answer += current ? current.kind + "" + current.flags + " " : "- ";
    }
    return answer;
}
function sameValue(first: any, second: any): string { return first === second ? "same" : "other"; }
function sameThing(first: Thing | undefined, second: Thing | undefined): boolean { return first === second; }
function indexOfSame(list: any[], value: any): number {
    for (let i = 0; i < list.length; i++) {
        if (list[i] === value)
            return i;
    }
    return -1;
}
function runOfEqual(list: number[]): number {
    let longest = 0, length = 0;
    for (let i = 1; i < list.length; i++) {
        if (list[i] !== list[i - 1])
            length = 0;
        else
            length++;
        if (length > longest)
            longest = length;
    }
    return longest;
}

console.log(values.map(truthOutside).join(" "));
console.log(values.map(notOutside).join(" "));
console.log(values.map(value => typeof chooseFirst(value, "other")).join(" "));
console.log(values.map(value => typeof chooseLast(value, "other")).join(" "));
for (let turn = 0; turn < 3; turn++)
    console.log(truthInLoop(values), truthInLoop(values.slice(turn * 7)), truthInLoop([]));
const things: Thing[] = [];
for (let kind = 1; kind <= 4; kind++) {
    for (let flags = 0; flags < 8; flags++)
        things.push({ kind, flags, next: things[(kind * 7 + flags * 5) % 17], text: flags & 4 ? "t" + kind : undefined });
}
for (const thing of things)
    console.log(thing.kind, thing.flags, joinedTests(thing), truthOfThing(thing.next), truthOfText(thing.text));
console.log(joinedTestsInLoop(things));
console.log(values.map((value, index) => sameValue(value, values[index]) + indexOfSame(values, value)).join(" "));
console.log(things.map((thing, index) => sameThing(thing.next, things[index % 17])).join(" "));
console.log(runOfEqual([1, 1, 2, 2, 2, 3, NaN, NaN, 0, -0, 0]), truthOfThing(undefined), truthOfText(""), truthOfText(undefined));
