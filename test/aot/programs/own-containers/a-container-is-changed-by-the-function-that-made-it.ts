// Nobody else has the container: the function that made it changes it by itself, by name, under a key that only the run knows, or through a built-in. What follows must see the change.
const lines: string[] = [];
const say = (title: string, value: unknown) => lines.push(title + ": " + JSON.stringify(value));
const identity = <T>(value: T) => value;
const keys = ["0", "push", "1", "length", "-1", "map", "4294967295", "4294967294", "x"];

function aMethodByName(count: number) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        out.push(identity(i));
        if (i === 1) out.push = function (value: number) { Array.prototype.push.call(this, value * 10); return 0; };
    }
    return out;
}
say("a method is stored by name", aMethodByName(4));

function underAKeyOfTheRun(which: number) {
    const out: unknown[] & Record<string, unknown> = [1, 2] as never;
    const results: unknown[] = [];
    for (let turn = 0; turn < 3; turn++) {
        try {
            results.push(typeof out.push === "function" ? out.push(turn) : "no function");
        } catch (error) {
            results.push((error as Error).constructor.name);
        }
        if (turn === 0) out[identity(keys[which])] = turn === 0 ? (which === 3 ? 1 : () => "stored") : 0;
    }
    return [results, out.length, Object.keys(out).join()];
}
for (let which = 0; which < keys.length; which++) say("stored under " + keys[which], underAKeyOfTheRun(which));

function underANumberOfTheRun(position: number) {
    const out: number[] = [1, 2, 3];
    let sum = 0;
    for (let turn = 0; turn < 3; turn++) {
        out[identity(position)] = 7;
        for (let i = 0; i < 4; i++) sum += out[i] ?? 100;
        try {
            out.push(turn);
        } catch (error) {
            sum += (error as Error).constructor.name.length;
        }
    }
    return [sum, out.length, Object.keys(out).length, out[position]];
}
for (const position of [0, 2, 3, 5, -1, 1.5, 4294967294, 4294967295, NaN]) say("stored at " + position, underANumberOfTheRun(position));

function itsLength() {
    const out: number[] = [1, 2, 3, 4];
    out.length = identity(2);
    out.push(9);
    out.length = identity(6);
    let holes = 0;
    for (let i = 0; i < out.length; i++) if (!(i in out)) holes++;
    return [out, holes, out.indexOf(undefined as never), out.includes(undefined as never)];
}
say("its length", itsLength());

function anElementIsDeleted() {
    const out: number[] = [1, 2, 3];
    delete out[identity(1)];
    let text = "";
    out.forEach((value, index) => { text += index + "=" + value + ";"; });
    for (const value of out) text += String(value) + ",";
    return [text, out.map(value => value * 2), out.length];
}
say("an element is deleted", anElementIsDeleted());

function definedByADescriptor() {
    const out: number[] = [1, 2, 3];
    let calls = 0;
    Object.defineProperty(out, "map", { value: () => { calls++; return "mine"; } });
    Object.defineProperty(out, 0, { get: () => { calls++; return 70; } });
    return [out.map(value => value), out[0] + out[1], calls, out.reduce((sum, value) => sum + value, 0)];
}
say("defined by a descriptor", definedByADescriptor());

function assignedTo() {
    const out: number[] = [1, 2];
    Object.assign(out, identity({ push: () => "assigned", 1: 20 }));
    return [(out.push as unknown as () => string)(), out];
}
say("Object.assign", assignedTo());

function itsPrototype() {
    class Loud extends Array<number> { push(...values: number[]) { return super.push(...values.map(value => -value)); } }
    const out: number[] = [];
    out.push(1);
    Object.setPrototypeOf(out, Loud.prototype);
    out.push(2);
    return [out, out instanceof Loud, out.map(value => value) instanceof Loud];
}
say("its prototype", itsPrototype());

function itsConstructor() {
    class Other extends Array<number> {}
    const out: number[] & { constructor: unknown } = [1, 2, 3] as never;
    const before = out.map(value => value) instanceof Other;
    out.constructor = Other;
    return [before, out.map(value => value) instanceof Other, out.filter(() => true) instanceof Other, out.slice() instanceof Other];
}
say("its constructor", itsConstructor());

function madeNotExtensible() {
    const out: number[] = [1];
    Object.preventExtensions(out);
    let refused = "";
    try { out.push(2); } catch (error) { refused = (error as Error).constructor.name; }
    out[0] = 5;
    return [out, refused];
}
say("made not extensible", madeNotExtensible());

function aMapChangedByName() {
    const table = new Map<string, number>();
    table.set("a", 1);
    table.get = () => 77;
    (table as unknown as Record<string, unknown>)[identity("has")] = () => "stored";
    return [table.get("a"), table.has("a"), table.size];
}
say("a Map", aMapChangedByName());

function aRegularExpression() {
    const pattern = /a(b)?/g;
    const first = "ab a".replace(pattern, "x");
    pattern.exec = () => null;
    pattern.lastIndex = identity(1);
    return [first, "ab a".replace(pattern, "x"), pattern.test("ab"), pattern.lastIndex];
}
say("a regular expression", aRegularExpression());

function aPromise() {
    const promise = Promise.resolve(1);
    (promise as unknown as Record<string, unknown>).then = function (resolve: (value: number) => void) { resolve(2); };
    return promise;
}
async function awaited() { return await aPromise(); }
awaited().then(value => { say("a promise with a then of its own", value); console.log(lines.join("\n")); });
