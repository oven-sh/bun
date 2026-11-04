function check(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}
function join(...parts) { return parts.join(""); }
function wide(text) { return (text + "Ā").slice(0, -1); }

function readsWrittenFirst(o) { return o.writtenFirstByItsCharacters; }
function readsParsedFirst(o) { return o.parsedFirstFromJSON; }
function readsWideFirst(o) { return o.madeFirstFromAWideString; }
function readsCyrillic(o) { return o.ключ; }
function readsCyrillicFirst(o) { return o.сначалаПоСимволам; }
function readsLong(o) { return o.aNameThatIsLongEnoughToAliasTheCharactersInTheFileInsteadOfCopyingThem; }
function readsLongFirst(o) { return o.anotherNameThatIsLongEnoughToAliasTheCharactersInTheFileAndIsMadeFirst; }
function hasOwn(o, name) { return Object.prototype.hasOwnProperty.call(o, name); }

{
    let o = { inTheProgramFirst: 1 };
    check(o[join("inThe", "Program", "First")], 1, "a name of the program, then its characters");
    check(o[wide("inTheProgramFirst")], 1, "and from a wide string");
    check(join("inThe", "Program", "First") in o, true, "and with in");
    check(hasOwn(o, join("inThe", "Program", "First")), true, "and with hasOwnProperty");
    check(Object.keys(o)[0], "inTheProgramFirst", "and from Object.keys");
    check(o[Object.keys(o)[0]], 1, "and by what Object.keys returned");
}
{
    let o = { };
    o[join("writtenFirst", "ByIts", "Characters")] = 2;
    check(readsWrittenFirst(o), 2, "the characters, then a name of the program");
    check(readsParsedFirst(JSON.parse('{"parsedFirstFromJSON":3}')), 3, "a key JSON.parse made first");
    o[wide("madeFirstFromAWideString")] = 4;
    check(readsWideFirst(o), 4, "a wide string first");
}
{
    let o = { ключ: 5 };
    check(o[join("кл", "юч")], 5, "a name that is not Latin-1");
    check(readsCyrillic(o), 5, "read by name");
    o[join("сначала", "По", "Символам")] = 6;
    check(readsCyrillicFirst(o), 6, "its characters first");
}
{
    let o = { aNameThatIsLongEnoughToAliasTheCharactersInTheFileInsteadOfCopyingThem: 7 };
    check(o[join("aNameThatIsLongEnoughToAlias", "TheCharactersInTheFileInsteadOfCopyingThem")], 7, "a long name");
    check(readsLong(o), 7, "read by name");
    o[join("anotherNameThatIsLongEnoughToAlias", "TheCharactersInTheFileAndIsMadeFirst")] = 8;
    check(readsLongFirst(o), 8, "its characters first");
}
{
    let o = [1, 2, 3];
    for (let name of ["length", "constructor", "toString", "valueOf", "prototype", "name", "message", "then", "next", "done", "value"]) {
        let made = join(name.slice(0, 2), name.slice(2));
        check(o[made], o[name], "a name the engine has: " + name);
        check(hasOwn(o, made), hasOwn(o, name), "with hasOwnProperty: " + name);
    }
    check(o[join("len", "gth")], 3, "length");
    check((function () { }).name, "", "name");
}
{
    let o = { present: 1 };
    for (let i = 0; i < 100; ++i) {
        check(join("notAnywhere", String(i)) in o, false, "a name nothing has");
        check(o[join("notAnywhere", String(i))], undefined, "read");
    }
    check(join("mentionedOnly", "InAFunctionThatNeverRuns") in o, false, "a name of the program that nothing has made");
    check(o[join("mentionedOnly", "InAFunctionThatNeverRuns")], undefined, "read");
    function neverRuns(x) { return x.mentionedOnlyInAFunctionThatNeverRuns; }
}
{
    const constant = "aStringConstantUsedAsAKey";
    let o = { };
    o[constant] = 9;
    check(o.aStringConstantUsedAsAKey, 9, "a string constant as a key");
    check(o[join("aStringConstant", "UsedAsAKey")], 9, "and its characters");
    let viaMap = new Map([[constant, 1]]);
    check(viaMap.get(join("aStringConstant", "UsedAsAKey")), 1, "and in a Map");
    check(Symbol.for(constant), Symbol.for(join("aStringConstant", "UsedAsAKey")), "and in the symbol registry");
    check(Symbol(constant).description, constant, "and as a description");
}
{
    let o = { ab: 1, a: 2, abc: 3, abcd: 4 };
    check(o[join("a", "b")], 1, "two characters");
    check(o[join("a")], 2, "one character");
    check(o[join("a", "bc")], 3, "three characters");
    check(o[join("ab", "cd")], 4, "four characters");
    check(o[""], undefined, "none");
    o[""] = 5;
    check(o[join()], 5, "the empty name");
}
{
    class Counter {
        #count = 0;
        static created = 0;
        increment() { return ++this.#count; }
        get doubled() { return this.#count * 2; }
    }
    let counter = new Counter;
    check(counter[join("incre", "ment")](), 1, "a method");
    check(counter[join("dou", "bled")], 2, "a getter");
    check(Counter[join("crea", "ted")], 0, "a static field");
    check(Reflect.ownKeys(Counter.prototype).join(), "constructor,increment,doubled", "the names of a prototype");
}
{
    let names = [];
    for (let i = 0; i < 2000; ++i)
        names.push("made" + i);
    let o = { };
    for (let name of names)
        o[name] = name.length;
    let total = 0;
    for (let name in o)
        total += o[name];
    check(total, names.reduce((sum, name) => sum + name.length, 0), "many names that are not in the program");
    check(o.made7, 5, "one of which is");
    check(o.made1999, 8, "and another");
}
console.log("passed");
