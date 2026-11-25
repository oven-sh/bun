// Elements stored beyond the vector of a list: what lies between stays a hole.
// COUNT: operationAOTArrayPutAtIndexInSloppyCode <= 3000
// COUNT: operationAOTArrayPutAtIndex <= 100
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
function fill(list, index, value) { list[index] = value; return list; }
class Strict { static fill(list, index, value) { list[index] = value; return list; } }
const fillStrictly = Strict.fill;
function fillAny(list, index, value) { list[index] = value; return list; }
const show = list => { let shown = list.length + ":"; for (let i = 0; i < list.length; ++i) shown += i in list ? list[i] + "," : "_,"; return shown; };
for (const key of ["a", 1, 2.5, -1, 4294967295, 4294967296, null]) fillAny(key === 1 ? [] : {}, key, 1);
for (let round = 0; round < 400; ++round) {
    const index = round % 9;
    let expected = index + 1 + ":";
    for (let i = 0; i < index; ++i) expected += "_,";
    check("int", show(fill([], index, round)), expected + round + ",");
    check("int strictly", show(fillStrictly([], index, round)), expected + round + ",");
    check("any", show(fillAny([], index, round)), expected + round + ",");
    check("double", show(fill([1.5], index + 1, 2.5)), index + 2 + ":1.5," + "_,".repeat(index) + "2.5,");
    check("text", show(fill(["a", "b"], index + 2, "c")), index + 3 + ":a,b," + "_,".repeat(index) + "c,");
    check("object", fill([], index, { round })[index].round, round);
    check("undefined between", fill([], index + 1, 1)[0], undefined);
    check("number of holes", Object.keys(fillAny([1, 2, 3], index + 3, round)).length, 4);
}
for (let length = 0; length < 120; ++length) {
    for (const value of [length, length + .5, "s" + length, null, NaN, undefined]) {
        const list = [], other = [];
        for (let i = 0; i < length; i += 3) { fill(list, i, value); fillAny(other, i, value); }
        check("length", list.length, length ? Math.floor((length - 1) / 3) * 3 + 1 : 0);
        for (let i = 0; i < length; ++i) { check("element", list[i], i % 3 ? undefined : value); check("other element", other[i], i % 3 ? undefined : value); check("presence", i in list, !(i % 3)); }
        fill(list, length + 70, "far");
        check("far", list[length + 70], "far");
        check("behind far", list.length, length + 71);
    }
}
for (const index of [100, 1000, 5000, 100000, 1e6, 2147483646, 2147483647, 2147483648, 4294967294]) { const list = fill([1], index, "x"); check("large " + index, list.length, index + 1); check("at large " + index, list[index], "x"); check("other at large", list[0], 1); }
for (const index of [4294967295, 4294967296, -1, -2147483648, 1.5]) { const list = fillAny([1], index, "x"); check("no index " + index, list.length, 1); check("at no index " + index, list[index], "x"); }
const strict = f => { try { f(); return "ended"; } catch (error) { return error instanceof TypeError; } };
const sealed = Object.preventExtensions([1, 2]), frozen = Object.freeze([1]);
fill(sealed, 4, 5); check("not extensible", sealed.length, 2);
fill(frozen, 4, 5); check("frozen", frozen.length, 1);
check("strictly not extensible", strict(() => fillStrictly(sealed, 4, 5)), true);
check("strictly frozen", strict(() => fillStrictly(frozen, 4, 5)), true);
const fixed = Object.defineProperty([1, 2], "length", { writable: false });
fill(fixed, 3, 1); check("length is not writable", fixed.length, 2);
class List extends Array { get last() { return this[this.length - 1]; } }
check("heir", fill(new List(), 5, 7).last, 7);
const named = Object.assign([1], { name: "n" });
check("with a name", show(fill(named, 4, 2)) + named.name, "5:1,_,_,_,2,n");
let stored = "";
const above = Object.setPrototypeOf([], Object.create(Array.prototype, { 3: { set(value) { stored += value; }, get() { return "above"; } } }));
fill(above, 3, "s"); check("setter above", stored + above.length, "s0");
fill(above, 4, "t"); check("behind setter above", above[4] + above[3] + above.length, "tabove5");
const object = {}, below = Object.create({ set 2(value) { this.kept = value; } });
fillAny(object, 0, 1); fillAny(object, 9, 2); check("object", Object.keys(object).join(), "0,9"); check("between", object[5], undefined);
fillAny(below, 0, 1); fillAny(below, 2, 5); check("setter above an object", below.kept + Object.keys(below).join(), "50,kept");
fillAny(below, 3, 6); check("behind", Object.keys(below).join(), "0,3,kept");
console.log("ended", failures);
