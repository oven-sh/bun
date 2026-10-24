// A function makes an array, a Map or a Set and goes on using it. Until it hands the container to somebody, nobody else can have changed it.
// Each function here hands it on in another way, in the middle of its work, to somebody who replaces a method, the iterator, the prototype or an element's meaning. What follows must see the change.
const lines: string[] = [];
const say = (title: string, value: unknown) => lines.push(title + ": " + JSON.stringify(value));
type Numbers = number[] & Record<string, unknown>;

const loudPush = function (this: number[], value: number) { Array.prototype.push.call(this, -value); return 99; };
function replacePush(target: unknown) { (target as Numbers).push = loudPush; }
function replacePushOfThis(this: unknown) { (this as Numbers).push = loudPush; }
const identity = (value: number) => value;

function neverHandedOn(count: number) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(identity(i));
    return out;
}
say("never handed on", neverHandedOn(5));

function handedOnAsAnArgument(count: number) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        out.push(identity(i));
        if (i === 2) replacePush(out);
    }
    return out;
}
say("as an argument, in the third turn", handedOnAsAnArgument(6));

function handedOnAsThis(count: number) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        if (i === 3) replacePushOfThis.call(out);
        out.push(identity(i));
    }
    return out;
}
say("as this", handedOnAsThis(6));

const shelf: { kept?: number[] } = {};
function changeWhatIsOnTheShelf() { if (shelf.kept) replacePush(shelf.kept); return 7; }
function storedIntoAnObject(count: number) {
    const out: number[] = [];
    out.push(1);
    shelf.kept = out;
    for (let i = 0; i < count; i++) out.push(i === 1 ? changeWhatIsOnTheShelf() : identity(i));
    shelf.kept = undefined;
    return out;
}
say("stored into an object that a callee reads", storedIntoAnObject(4));

let variableOfTheModule: number[] | undefined;
function changeTheVariable() { if (variableOfTheModule) replacePush(variableOfTheModule); return 8; }
function storedIntoAVariable(count: number) {
    const out: number[] = [];
    variableOfTheModule = out;
    for (let i = 0; i < count; i++) out.push(i === 2 ? changeTheVariable() : identity(i));
    variableOfTheModule = undefined;
    return out;
}
say("stored into a variable of the module", storedIntoAVariable(5));

function run(callback: () => void) { callback(); return 5; }
function capturedByAClosure(count: number) {
    const out: number[] = [];
    const change = () => { replacePush(out); };
    for (let i = 0; i < count; i++) out.push(i === 1 ? run(change) : identity(i));
    return out;
}
say("captured by a closure that a callee calls", capturedByAClosure(4));

function capturedByAClosureThatIsOnlyMade(count: number) {
    const out: number[] = [];
    const change = () => { replacePush(out); };
    for (let i = 0; i < count; i++) out.push(identity(i));
    return [out, typeof change];
}
say("captured by a closure that nobody calls", capturedByAClosureThatIsOnlyMade(3));

function insideAnotherContainer(count: number) {
    const out: number[] = [];
    const box = [out];
    for (let i = 0; i < count; i++) {
        out.push(identity(i));
        if (i === 0) replacePush(box[0]);
    }
    return out;
}
say("through an array that holds it", insideAnotherContainer(3));

function onlyOnOneSide(count: number, leak: boolean) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        if (leak && i === 1) replacePush(out);
        out.push(identity(i));
    }
    return out;
}
say("on one side of a branch, not taken", onlyOnOneSide(4, false));
say("on one side of a branch, taken", onlyOnOneSide(4, true));

function inAHandler(count: number) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        try {
            if (i === 1) throw new Error("now");
            out.push(identity(i));
        } catch {
            replacePush(out);
        }
    }
    return out;
}
say("in a handler", inAHandler(4));

function inAFinallyBlock(count: number) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        try { out.push(identity(i)); } finally { if (i === 0) replacePush(out); }
    }
    return out;
}
say("in a finally block", inAFinallyBlock(3));

function toTheCallbackOfItsOwnMethod() {
    const out: number[] = [1, 2, 3];
    out.forEach((value, index, all) => { if (index === 0) replacePush(all); });
    out.push(4);
    return out;
}
say("to the callback of its own method", toTheCallbackOfItsOwnMethod());

function theIterator() {
    const out: number[] = [1, 2, 3];
    const seen: number[] = [];
    for (const value of out) seen.push(value);
    ((target: number[]) => { target[Symbol.iterator] = function* () { yield 42; } as never; })(out);
    for (const value of out) seen.push(value);
    return [seen, [...out], Math.max(...out)];
}
say("the iterator is replaced", theIterator());

function thePrototype() {
    const out: number[] = [3, 1, 2];
    const first = out.map(value => value * 2);
    ((target: object) => Object.setPrototypeOf(target, { map: () => "mine", length: "no" }))(out);
    return [first, (out as unknown as { map(): string }).map(), Array.isArray(out), out.length];
}
say("the prototype is replaced", thePrototype());

function anElementBecomesAnAccessor() {
    const out: number[] = [1, 2, 3];
    let sum = 0;
    for (let i = 0; i < out.length; i++) sum += out[i];
    let reads = 0;
    ((target: number[]) => Object.defineProperty(target, 1, { get() { reads++; return 50; }, configurable: true }))(out);
    for (let i = 0; i < out.length; i++) sum += out[i];
    return [sum, reads];
}
say("an element becomes an accessor", anElementBecomesAnAccessor());

function frozenBySomebody() {
    const out: number[] = [1];
    out.push(2);
    ((target: number[]) => Object.freeze(target))(out);
    let refused = "";
    try { out.push(3); } catch (error) { refused = (error as Error).constructor.name; }
    try { out[0] = 9; } catch (error) { refused += " " + (error as Error).constructor.name; }
    return [out, refused];
}
say("frozen by somebody", frozenBySomebody());

function aMap(count: number) {
    const table = new Map<number, number>();
    for (let i = 0; i < count; i++) {
        table.set(i, identity(i));
        if (i === 1) ((target: Map<number, number>) => { target.set = function (key: number) { Map.prototype.set.call(this, key, -1); return this; }; })(table);
    }
    return [...table];
}
say("a Map", aMap(4));

function aSet(count: number) {
    const members = new Set<number>();
    let hits = 0;
    for (let i = 0; i < count; i++) {
        members.add(identity(i));
        if (members.has(0)) hits++;
        if (i === 1) ((target: Set<number>) => { target.has = () => false; })(members);
    }
    return [[...members], hits];
}
say("a Set", aSet(4));

function theRestParameter(...values: number[]) {
    const before = Math.max(...values);
    ((target: number[]) => { target[Symbol.iterator] = function* () { yield -5; } as never; })(values);
    return [before, Math.max(...values), values.length];
}
say("the rest parameter", theRestParameter(1, 2, 3));

function theResultOfABuiltIn(text: string) {
    const parts = text.split(",");
    const first = parts.map(part => part.length);
    ((target: string[]) => { target.map = (() => "mine") as never; })(parts);
    return [first, parts.map(part => part.length)];
}
say("the result of a built-in", theResultOfABuiltIn("a,bb,ccc"));

console.log(lines.join("\n"));
