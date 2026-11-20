function isIn(thing) { return "length" in thing; }
function isInByOtherName(thing) { return "mark" in thing; }
function isOwn(thing) { return Object.prototype.hasOwnProperty.call(thing, "length"); }
function hasOwn(thing) { return Object.hasOwn(thing, "length"); }
function said(ask, thing) {
    let yes = 0, no = 0, thrown = "";
    for (let turn = 0; turn < 300; turn++) {
        try { if (ask(thing)) yes++; else no++; } catch (error) { thrown = error.constructor.name; }
    }
    return yes + "|" + no + "|" + thrown;
}
const things = [{ length: 1 }, { other: 1 }, [1, 2], "text", "", 7, 0.5, true, null, undefined, Symbol("made up"), 10n, function named(a, b) { }, new String("text"), new Uint8Array(3), /x/, new Map(), new Date(0), (function () { return arguments; })(1, 2)];
function readsLength(thing) { return thing.length; }
function readsOtherName(thing) { return thing.mark; }
let read = 0;
for (let turn = 0; turn < 6000; turn++) {
    const thing = things[turn % things.length];
    if (thing === null || thing === undefined) continue;
    if (readsLength(thing) !== undefined) read += 1;
    if (readsOtherName(thing) !== undefined) read += 100000;
}
console.log(read);
for (let round = 0; round < 2; round++) {
    for (const thing of things)
        console.log(round, typeof thing, said(isIn, thing), said(isInByOtherName, thing), said(isOwn, thing), said(hasOwn, thing));
}
let mixed = 0;
for (let turn = 0; turn < 3000; turn++) {
    const thing = things[turn % things.length];
    try { if (isIn(thing)) mixed += 1; } catch { mixed += 1000; }
    try { if (isOwn(thing)) mixed += 3; } catch { mixed += 5000; }
}
console.log(mixed);
