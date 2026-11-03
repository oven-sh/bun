// `value instanceof Error` over lists of errors, texts and numbers. Each list is its own, so that what is done to one says nothing of another.
function count(values: unknown[], constructor: Function, turns: number): number {
    let yes = 0;
    for (let i = 0; i < turns; i++) if (values[i % values.length] instanceof constructor) yes++;
    return yes;
}

// As made.
const asMade: unknown[] = [new Error("x"), "text", new TypeError("y"), 5, RangeError("z"), null, undefined];
let made = 0;
for (let i = 0; i < 700; i++) if (asMade[i % 7] instanceof Error) made++;
let madeType = 0;
for (let i = 0; i < 700; i++) if (asMade[i % 7] instanceof TypeError) madeType++;
let madeObject = 0;
for (let i = 0; i < 700; i++) if (asMade[i % 7] instanceof Object) madeObject++;
console.log("as made", made, madeType, madeObject);

// Names stored on the errors and on a prototype change nothing above them.
const written: unknown[] = [new Error("x"), 1, new SyntaxError("y")];
(written[0] as any).extra = 1;
(written[2] as Error).message = "other";
SyntaxError.prototype.message = "default";
let namesWritten = 0;
for (let i = 0; i < 300; i++) if (written[i % 3] instanceof Error) namesWritten++;
console.log("names written", namesWritten, new SyntaxError().message);

// One error is given another prototype.
const moved: unknown[] = [new Error("x"), 1, new TypeError("y")];
Object.setPrototypeOf(moved[2], null);
let oneMoved = 0;
for (let i = 0; i < 300; i++) if (moved[i % 3] instanceof Error) oneMoved++;
console.log("one moved", oneMoved);

const assigned: unknown[] = [new Error("x"), 1, new TypeError("y")];
(assigned[0] as any).__proto__ = Array.prototype;
let oneAssigned = 0;
let oneArray = 0;
for (let i = 0; i < 300; i++) {
    if (assigned[i % 3] instanceof Error) oneAssigned++;
    if (assigned[i % 3] instanceof Array) oneArray++;
}
console.log("one assigned", oneAssigned, oneArray);

const reflected: unknown[] = [new Error("x"), 1, new TypeError("y")];
Reflect.setPrototypeOf(reflected[0] as object, Map.prototype);
let oneReflected = 0;
for (let i = 0; i < 300; i++) if (reflected[i % 3] instanceof Error) oneReflected++;
console.log("one reflected", oneReflected);

// Made for another new.target.
class Other {}
const constructed: unknown[] = [Reflect.construct(Error, ["x"], Other), 1, Reflect.construct(TypeError, ["y"])];
let forOther = 0;
let isOther = 0;
for (let i = 0; i < 300; i++) {
    if (constructed[i % 3] instanceof Error) forOther++;
    if (constructed[i % 3] instanceof Other) isOther++;
}
console.log("another new.target", forOther, isOther);

// Other classes, with names of the program on the objects.
const others: unknown[] = [new Map(), new Set(), new Date(0), /x/, new ArrayBuffer(8), Promise.resolve(1), 0];
for (const object of others) if (typeof object === "object") (object as any).mine = 1;
let maps = 0;
let objects = 0;
for (let i = 0; i < 700; i++) {
    if (others[i % 7] instanceof Map) maps++;
    if (others[i % 7] instanceof Object) objects++;
}
console.log("other classes", maps, objects, count(others, Date, 700), count(others, RegExp, 700));

// Made below what the program names.
const below: unknown[] = [Object.create(null), 1, Object.create(Error.prototype), Object.create(Map.prototype), {}, Object.create({})];
let belowObject = 0;
let belowError = 0;
let belowMap = 0;
for (let i = 0; i < 600; i++) {
    if (below[i % 6] instanceof Object) belowObject++;
    if (below[i % 6] instanceof Error) belowError++;
    if (below[i % 6] instanceof Map) belowMap++;
}
console.log("made below", belowObject, belowError, belowMap);

// The link above a prototype of the realm is cut, in the end: every loop above has run by now, this one runs behind it.
const late: unknown[] = [new URIError("x"), 1, new Error("y")];
function lateCount(): number {
    let yes = 0;
    for (let i = 0; i < 300; i++) if (late[i % 3] instanceof Error) yes++;
    return yes;
}
console.log("before the cut", lateCount());
Object.setPrototypeOf(URIError.prototype, Object.prototype);
console.log("behind the cut", lateCount(), new URIError("z") instanceof Error);
