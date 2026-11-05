// A store by name that creates a field asks whether anything above the object stops it. What is above changes while the program runs.
"use strict";
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
function attempt(what, action) {
    try {
        say(what + ":", action());
    } catch (error) {
        say(what + ":", error.constructor.name);
    }
}
function describe(object) {
    return JSON.stringify(object) + " [" + Object.keys(object).join() + "]";
}
// What comes out of evaluated text is anything: nothing is proven about the receivers.
const hide = (0, eval)("(value) => value");
function storeLabel(given, value) {
    const object = hide(given);
    object.label = value;
    return object;
}
function storeCount(given, value) {
    const object = hide(given);
    object.count = value;
    return object;
}
function storeBoth(given, first, second) {
    const object = hide(given);
    object.count = first;
    object.label = second;
    return object;
}
// Seen code gives every kind of object the two names, so that their layouts have fields for them.
function fill(object) {
    object.count = -1;
    object.label = "filled";
    return object;
}

function Plain(id) {
    this.id = id;
}
function makeBelow(prototype, id) {
    const made = Object.create(prototype);
    made.id = id;
    return made;
}
function Late(id) {
    this.id = id;
}
class Counted {
    constructor(id) {
        this.id = id;
    }
    describe() {
        return "counted " + this.id;
    }
}
class WithAccessor extends Counted {
    get label() {
        return "from the getter";
    }
}
class WithBoth extends Counted {
    get label() {
        return "got " + this.hidden;
    }
    set label(value) {
        this.hidden = value;
    }
}

for (const filled of [fill({ id: -1 }), fill(new Plain(-1)), fill(new Counted(-1)), fill(new Late(-1)), fill(makeBelow(null, -1))])
    say("filled:", describe(filled));

// Warm: the same stores on several kinds of objects, so that whatever remembers something has remembered it.
for (let round = 0; round < 3; ++round) {
    attempt("literal " + round, () => describe(storeBoth({ id: round }, round, "l" + round)));
    attempt("constructor function " + round, () => describe(storeBoth(new Plain(round), round, "p" + round)));
    attempt("class " + round, () => describe(storeBoth(new Counted(round), round, "c" + round)));
    attempt("getter alone above " + round, () => describe(storeBoth(new WithAccessor(round), round, "a" + round)));
    attempt("getter and setter above " + round, () => describe(storeBoth(new WithBoth(round), round, "b" + round)));
}

// A setter arrives on the prototype of a constructor function.
attempt("before the setter", () => describe(storeLabel(new Plain(10), "own")));
let seen = [];
Object.defineProperty(Plain.prototype, "label", { set(value) { seen.push(value); }, get() { return "above"; }, configurable: true });
attempt("behind the setter", () => describe(storeLabel(new Plain(11), "caught")) + " " + seen.join());
attempt("count still passes", () => describe(storeCount(new Plain(12), 5)));
delete Plain.prototype.label;
attempt("the setter is gone", () => describe(storeLabel(new Plain(13), "own again")) + " " + seen.join());

// A property that cannot be written arrives.
Object.defineProperty(Plain.prototype, "count", { value: 99, writable: false, configurable: true });
attempt("read-only above", () => describe(storeCount(new Plain(14), 5)));
Object.defineProperty(Plain.prototype, "count", { value: 99, writable: true, configurable: true });
attempt("writable above", () => describe(storeCount(new Plain(15), 5)));
delete Plain.prototype.count;

// On the class's prototype object.
attempt("class before", () => describe(storeLabel(new Counted(20), "own")));
Object.defineProperty(Counted.prototype, "label", { get() { return "late getter"; }, configurable: true });
attempt("class behind a late getter", () => describe(storeLabel(new Counted(21), "refused")));
delete Counted.prototype.label;
attempt("class, the getter is gone", () => describe(storeLabel(new Counted(22), "own")));

// Nothing above.
attempt("no prototype", () => describe(storeLabel(makeBelow(null, 33), "own")));

// The chain gets longer: the prototype gets another prototype.
const above = { set label(value) { seen.push("grand " + value); } };
attempt("late before", () => describe(storeLabel(new Late(40), "own")));
Object.setPrototypeOf(Late.prototype, above);
attempt("late behind a new grandparent", () => describe(storeLabel(new Late(41), "caught")) + " " + seen.at(-1));
Object.setPrototypeOf(Late.prototype, Object.prototype);
attempt("late, back", () => describe(storeLabel(new Late(42), "own")));

// The prototype is an object of a layout, and it is frozen later. Another object of the same layout is not.
function parent(label) {
    return { label, kind: "parent" };
}
const frozenParent = parent("frozen one");
const openParent = parent("open one");
attempt("below the open parent", () => describe(storeLabel(makeBelow(openParent, 50), "own")));
attempt("below the parent that will be frozen", () => describe(storeLabel(makeBelow(frozenParent, 51), "own")));
Object.freeze(frozenParent);
attempt("below the frozen parent", () => describe(storeLabel(makeBelow(frozenParent, 52), "refused")));
attempt("below the open parent again", () => describe(storeLabel(makeBelow(openParent, 53), "own")));

// A proxy above.
const log = [];
const proxy = new Proxy({}, { set(target, key, value, receiver) { log.push(String(key)); return Reflect.set(target, key, value, receiver); } });
attempt("below a proxy", () => describe(storeBoth(makeBelow(proxy, 60), 1, "through")) + " " + log.join());

// An object becomes a prototype and then gets the field: who reads through it sees it.
const becomes = { id: 70 };
const child = makeBelow(becomes, 71);
function readLabel(object) {
    return object.label;
}
for (let round = 0; round < 5; ++round)
    attempt("child reads " + round, () => String(readLabel(child)));
storeLabel(becomes, "arrived");
attempt("child reads behind the store", () => String(readLabel(child)));

console.log(lines.join("\n"));
