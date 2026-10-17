// A Set or Map of constants in a module variable that is only ever asked with has(), get() or size is never made: the lookups go to the table. One that is walked, changed, compared or handed on is made as ever.
// IR= 1 isColor table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IR= 0 isColor GetModuleVariable
// IRT= 0 isColor CallDirect
// IR= 1 codeOf table in image \d+ = CallBuiltin ConstantTableGet#\d+
// IR= 1 hasCode table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IR= 0 codeOf GetModuleVariable
// IR= 0 isWalked ConstantTableHas
// IR= 0 isChanged ConstantTableHas
// IR= 0 isHandedOn ConstantTableHas
// IR= 0 isCompared ConstantTableHas
// IR= 1 isMeasured table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IR= 0 isExported ConstantTableHas
// IR= 0 isStoredTwice ConstantTableHas
// IR= 1 isVowel table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IR= 0 isVowel CallBuiltin Set#
// IR= 2 isDigitName table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IR= 0 isDigitName CallBuiltin Set#
// IR= 1 returnsItsSet CallBuiltin Set#
// IR= 0 returnsItsSet ConstantTableHas
// IR= 0 askedBeforeItIsMade ConstantTableHas
// IR= 1 askedBeforeItIsDeclared table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IR= 1 askedBeforeItIsDeclared ReferenceError
// IR= 2 askedTwice table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IRT= 0 askedTwice CallDirect
const COLORS = new Set(["red", "green", "blue", "cyan", "magenta", "yellow", "black", "white", "orange", "purple"]);
const CODES = new Map<string, number | string | boolean | null>([["ok", 200], ["missing", 404], ["text", "plain"], ["half", 0.5], ["yes", true], ["nothing", null]]);
const WALKED = new Set(["w1", "w2"]);
const CHANGED = new Set(["c1", "c2"]);
const HANDED_ON = new Set(["h1", "h2"]);
const COMPARED = new Set(["e1", "e2"]);
const MEASURED = new Set(["m1", "m2"]);
export const EXPORTED = new Set(["x1", "x2"]);
let STORED_TWICE = new Set(["s1", "s2"]);

export function isColor(name: string): boolean {
    return COLORS.has(name);
}
export function codeOf(name: string) {
    return CODES.get(name);
}
export function hasCode(name: string): boolean {
    return CODES.has(name);
}
export function isWalked(name: string): boolean {
    return WALKED.has(name);
}
export function isChanged(name: string): boolean {
    return CHANGED.has(name);
}
export function isHandedOn(name: string): boolean {
    return HANDED_ON.has(name);
}
export function isCompared(name: string): boolean {
    return COMPARED.has(name);
}
export function isMeasured(name: string): boolean {
    return MEASURED.has(name);
}
export function isExported(name: string): boolean {
    return EXPORTED.has(name);
}
export function isStoredTwice(name: string): boolean {
    return STORED_TWICE.has(name);
}
export function isVowel(letter: string): boolean {
    const vowels = new Set(["a", "e", "i", "o", "u"]);
    return vowels.has(letter);
}
export function isDigitName(first: string, second: string): boolean {
    const digits = new Set(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]);
    return digits.has(first) && digits.has(second);
}
export function returnsItsSet(name: string): Set<string> | boolean {
    const made = new Set(["r1", "r2"]);
    return made.has(name) ? made : false;
}
export function askedBeforeItIsMade(name: string): string {
    try {
        return String(LATE.has(name));
    } catch (error) {
        return (error as Error).constructor.name;
    }
}
export function askedBeforeItIsDeclared(name: string): string {
    try {
        return String(DECLARED_LATE.has(name));
    } catch (error) {
        return (error as Error).constructor.name;
    }
}
export function askedTwice(first: string, second: string): string {
    const one = COLORS.has(first);
    if (first === second) return "same";
    return one + "," + COLORS.has(second);
}
const tooEarly = askedBeforeItIsDeclared("d1");
const DECLARED_LATE = new Set(["d1", "d2"]);
const early = askedBeforeItIsMade("l1");
var LATE = new Set(["l1", "l2"]);
function taken(set: Set<string>) {
    return set.size;
}
const kept: unknown[] = [];

const out: string[] = [];
const names = "..red,blue,purple,pink,ok,missing,text,half,yes,nothing,w1,c1,c3,h1,e1,m1,x1,s1,s3,,..".slice(2, -2).split(",");
const wide = String.fromCharCode(0x4e2d);
names.push("gr" + "een".slice(0), "中red".slice(1), ["o", "k"].join(""), String(200));
names.push("r" + names[0].slice(1), "mis" + names[5].slice(3), names[1] + names[2], wide.slice(1) + names[0] + wide.slice(1), (wide + "ok").slice(1) + wide.slice(1));
function round(label: string) {
    for (const name of names)
        out.push(label + " " + JSON.stringify(name) + " " + [isColor(name), String(codeOf(name)), hasCode(name), isWalked(name), isChanged(name), isHandedOn(name), isCompared(name), isMeasured(name), isExported(name), isStoredTwice(name)].join());
}
round("first");
out.push([...WALKED].join(), String(CHANGED.add("c3").size), String(taken(HANDED_ON)), String(COMPARED === (kept[0] ?? COMPARED)), String(MEASURED.size));
STORED_TWICE = new Set(["s3"]);
round("second");
out.push(String((COLORS as Set<unknown>).has(1)), String((COLORS as Set<unknown>).has(undefined)), String((CODES as Map<unknown, unknown>).get(null)), String((CODES as Map<unknown, unknown>).has({})));
out.push([isVowel("a"), isVowel("b"), isDigitName("one", "nine"), isDigitName("one", "ten"), returnsItsSet("r1") instanceof Set, returnsItsSet("r3"), early, askedBeforeItIsMade("l1"), askedBeforeItIsMade("l3"), tooEarly, askedBeforeItIsDeclared("d1"), askedBeforeItIsDeclared("d3"), askedTwice("red", "pink"), askedTwice("x", "x")].join());
let hits = 0;
for (let i = 0; i < 30000; i++) {
    if (isColor(i % 3 ? "color" + i : "cyan")) hits++;
    if (codeOf(i % 5 ? "code" + i : "half") === 0.5) hits++;
}
out.push(String(hits));
console.log(out.join("\n"));
