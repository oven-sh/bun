// What other code can see of the time at which an object is made: the order of getters and traps, the prototype that stands above it, its fields where something has thrown.
const seen = [];
const source = {
    get first() { seen.push("first"); return 1; },
    get second() { seen.push("second"); return 2; },
};
const watched = new Proxy({}, {
    get(target, key) { seen.push("get " + String(key)); return 7; },
});

function listsWhatGettersGive(flag, take) {
    const made = { a: source.first, b: source.second, c: watched.third };
    seen.push("made");
    if (flag)
        take(made);
    seen.push("done");
    return flag ? 0 : 1;
}

class Shape {
    constructor(width) { this.width = width; }
    area() { return this.width * this.width; }
}

function madeThenMethodReplaced(flag, change, take) {
    const shape = new Shape(3);
    change();
    if (flag)
        return take(shape);
    return -1;
}

function Old(n) { this.n = n; }
Old.prototype.tag = function () { return "old " + this.n; };

function madeThenPrototypeReplaced(flag, take) {
    const thing = new Old(5);
    Old.prototype = { tag() { return "new " + this.n; } };
    if (flag)
        return take(thing);
    return "none";
}

function steps(first, second, keep) {
    const state = { step: 0 };
    try {
        first();
        state.step = 1;
        second();
        state.step = 2;
    } catch (error) {
        if (keep)
            keep(state);
        return "caught";
    }
    return "passed";
}

function storedOnOneWay(early, late, keep) {
    const state = { mode: "a" };
    if (early)
        state.mode = "b";
    if (late)
        keep(state);
    return early ? 1 : 0;
}

function copiedThenChanged(source, flag, keep) {
    const copy = [...source];
    const fields = { ...source[0] };
    source.push({ n: 9 });
    source[0].n = 7;
    if (flag)
        keep({ copy, fields });
    return source.length;
}

function classMadeAgain(flag, keep) {
    const make = () => class Local { tag() { return "local"; } };
    const First = make();
    const item = new First();
    const Second = make();
    if (flag)
        keep({ isFirst: item instanceof First, isSecond: item instanceof Second });
    return flag ? 1 : 0;
}

function fails() { throw new Error("no"); }
function passes() { }

console.log(listsWhatGettersGive(true, made => seen.push("taken " + made.a + made.b + made.c)), listsWhatGettersGive(false, passes));
console.log(seen.join(" . "));
console.log(madeThenMethodReplaced(true, passes, shape => shape.area()));
console.log(madeThenMethodReplaced(true, () => { Shape.prototype.area = function () { return -this.width; }; }, shape => shape.area()));
console.log(madeThenMethodReplaced(true, () => { Object.setPrototypeOf(Shape.prototype, { kind: "flat" }); }, shape => shape.kind + " " + (shape instanceof Shape)));
console.log(madeThenPrototypeReplaced(true, thing => thing.tag()), madeThenPrototypeReplaced(true, thing => thing.tag()), madeThenPrototypeReplaced(false, passes));
let kept = null;
const keep = state => { kept = state; };
console.log(steps(fails, passes, keep), "step " + kept.step);
console.log(steps(passes, fails, keep), "step " + kept.step);
console.log(steps(passes, passes, keep), "step " + kept.step);
console.log(steps(fails, passes, null));
for (const early of [false, true]) {
    for (const late of [false, true]) {
        kept = null;
        console.log(storedOnOneWay(early, late, keep), kept ? kept.mode : "-");
    }
}
for (const flag of [true, false]) {
    kept = null;
    console.log(copiedThenChanged([{ n: 1 }, { n: 2 }], flag, keep), kept ? kept.copy.length + " " + kept.fields.n : "-");
    kept = null;
    console.log(classMadeAgain(flag, keep), kept ? kept.isFirst + " " + kept.isSecond : "-");
}
