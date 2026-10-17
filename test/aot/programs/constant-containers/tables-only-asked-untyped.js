// The same in a file without types: the calls are calls by name, and the variable's reads are tested where they stand.
// IR= 1 isColor table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IR= 0 isColor GetModuleVariable
// IR= 1 codeOf table in image \d+ = CallBuiltin ConstantTableGet#\d+
// IR= 0 codeOf GetModuleVariable
// IR= 1 isVowel table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IR= 0 isVowel CallBuiltin Set#
// IR= 0 isWalked ConstantTableHas
// IR= 0 isPatched ConstantTableHas
// IR= 0 isAskedOddly ConstantTableHas
// IR= 0 askedBeforeItIsMade ConstantTableHas
// IR= 1 askedBeforeItIsDeclared table in image \d+ = CallBuiltin ConstantTableHas#\d+
// IR= 1 askedBeforeItIsDeclared ReferenceError
const COLORS = new Set(["red", "green", "blue"]);
const CODES = new Map([["ok", 200], ["missing", 404], ["text", "plain"]]);
const WALKED = new Set(["w1", "w2"]);
const PATCHED = new Set(["p1", "p2"]);
const ASKED_ODDLY = new Set(["o1", "undefined"]);
export function isColor(name) {
    return COLORS.has(name);
}
export function codeOf(name) {
    return CODES.get(name);
}
export function isVowel(letter) {
    const vowels = new Set(["a", "e", "i", "o", "u"]);
    return vowels.has(letter);
}
export function isWalked(name) {
    return WALKED.has(name);
}
export function isPatched(name) {
    return PATCHED.has(name);
}
export function isAskedOddly(name) {
    return [ASKED_ODDLY.has(), ASKED_ODDLY.has(name, 1)].join();
}
export function askedBeforeItIsMade(name) {
    try {
        return String(LATE.has(name));
    } catch (error) {
        return error.constructor.name;
    }
}
export function askedBeforeItIsDeclared(name) {
    try {
        return String(DECLARED_LATE.has(name));
    } catch (error) {
        return error.constructor.name;
    }
}
const tooEarly = askedBeforeItIsDeclared("d1");
const DECLARED_LATE = new Set(["d1", "d2"]);
const early = askedBeforeItIsMade("l1");
var LATE = new Set(["l1", "l2"]);
const out = [];
for (const name of ["red", "pink", "ok", "text", "nothing", "a", "b", "w1", "p1", "o1", 1, null, undefined, {}, "re" + "d".slice(0)])
    out.push([String(name), isColor(name), codeOf(name), isVowel(name), isWalked(name), isPatched(name), isAskedOddly(name)].join());
PATCHED.has = () => "patched";
out.push(isPatched("p1"), [...WALKED].join(), early, askedBeforeItIsMade("l1"), tooEarly, askedBeforeItIsDeclared("d1"), askedBeforeItIsDeclared("d3"));
console.log(out.join("\n"));
