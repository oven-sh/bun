const report = value => console.log(typeof value === "string" ? value : Object.is(value, -0) ? "-0" : String(value));
const log = [];
const nameOf = (key) => typeof key === "symbol" ? key.description : key;
function watched(name, target) {
    return new Proxy(target, {
        get(object, key, receiver) { log.push(name + " get " + nameOf(key)); return Reflect.get(object, key, receiver); },
        has(object, key) { log.push(name + " has " + nameOf(key)); return Reflect.has(object, key); },
        getOwnPropertyDescriptor(object, key) { log.push(name + " describe " + nameOf(key)); return Reflect.getOwnPropertyDescriptor(object, key); },
        getPrototypeOf(object) { log.push(name + " prototype"); return Reflect.getPrototypeOf(object); },
        ownKeys(object) { log.push(name + " keys"); return Reflect.ownKeys(object); },
    });
}
function source(limit, more = {}) {
    let turn = 0;
    const iterator = watched("iterator", {
        next(...sent) {
            log.push("next is called with " + sent.length + " on " + (this === iterator));
            turn++;
            return watched("result", { done: turn > limit, value: "value " + turn });
        },
        ...more,
    });
    return watched("iterable", { [Symbol.iterator](...sent) { log.push("@@iterator is called with " + sent.length); return iterator; } });
}
function tell(title, act) {
    log.length = 0;
    let outcome;
    try {
        outcome = "gives " + act();
    } catch (error) {
        outcome = "throws " + (error instanceof Error ? error.name + ": " + error.message : String(error));
    }
    report(title + " " + outcome);
    for (const line of log)
        report("    " + line);
}
const withReturn = (answer) => ({ return(...sent) { log.push("return is called with " + sent.length); return answer(); } });

function all(things) { const seen = []; for (const thing of things) seen.push(thing); return seen.join(); }
function firstOf(things) { for (const thing of things) return thing; return "nothing"; }
function untilSecond(things) { let count = 0; for (const thing of things) { if (++count === 2) break; } return count; }
function throwsAtFirst(things) { for (const thing of things) throw new RangeError("from the body at " + thing); }
function skipsFirst(things) { const seen = []; for (const thing of things) { if (!seen.length) { seen.push("skipped"); continue; } seen.push(thing); } return seen.join(); }
function nested(outer, inner) { const seen = []; for (const a of outer) { for (const b of inner) { seen.push(a + "/" + b); break; } } return seen.join(); }
function labeled(outer, inner) { let count = 0; out: for (const a of outer) { for (const b of inner) { count++; break out; } } return count; }
function inTry(things) { try { for (const thing of things) throw new Error("caught at " + thing); } catch (error) { return error.message; } finally { log.push("finally"); } }
function patternOfTwo(things) { const [a, b] = things; return a + " and " + b; }
function patternWithRest(things) { const [a, ...rest] = things; return a + " and " + rest.length; }
function patternWithHole(things) { const [, b] = things; return b; }
function patternWithDefault(things) { const [a = "default", b = "default"] = things; return a + " and " + b; }
function emptyPattern(things) { const [] = things; return "nothing taken"; }
function spread(things) { return [...things].length; }
function asArguments(things) { return Math.max(0, ...[...things].map((text) => text.length)); }

for (const [title, walk] of Object.entries({ all, firstOf, untilSecond, throwsAtFirst, skipsFirst, inTry, patternOfTwo, patternWithRest, patternWithHole, patternWithDefault, emptyPattern, spread, asArguments })) {
    tell(title + " over three", () => walk(source(3)));
    tell(title + " over none", () => walk(source(0)));
    tell(title + " with return", () => walk(source(3, withReturn(() => ({})))));
    tell(title + " with a return that gives no object", () => walk(source(3, withReturn(() => 1))));
    tell(title + " with a return that throws", () => walk(source(3, withReturn(() => { throw new EvalError("from return"); }))));
    tell(title + " with a return that is no function", () => walk(source(3, { return: 1 })));
    tell(title + " with a return that is null", () => walk(source(3, { return: null })));
}
tell("nested", () => nested(source(2, withReturn(() => ({}))), source(2, withReturn(() => ({})))));
tell("labeled", () => labeled(source(2, withReturn(() => ({}))), source(2, withReturn(() => ({})))));

// What is no iterable, and iterators that answer badly.
for (const [title, walk] of Object.entries({ all, firstOf, patternOfTwo, patternWithRest })) {
    for (const [what, thing] of Object.entries({
        undefined: undefined, null: null, number: 1, boolean: true, symbol: Symbol("s"), object: {}, function() {},
        "an @@iterator that is no function": { [Symbol.iterator]: 1 },
        "an @@iterator that is null": { [Symbol.iterator]: null },
        "an @@iterator that gives no object": { [Symbol.iterator]() { return 1; } },
        "an @@iterator that gives undefined": { [Symbol.iterator]() {} },
        "an @@iterator that throws": { [Symbol.iterator]() { throw new EvalError("from @@iterator"); } },
        "a getter for @@iterator that throws": { get [Symbol.iterator]() { throw new EvalError("from the getter"); } },
        "no next": { [Symbol.iterator]() { return {}; } },
        "a next that is no function": { [Symbol.iterator]() { return { next: 1 }; } },
        "a next that gives no object": { [Symbol.iterator]() { return { next() { return 1; } }; } },
        "a next that gives null": { [Symbol.iterator]() { return { next() { return null; } }; } },
        "a next that throws": { [Symbol.iterator]() { return { next() { throw new EvalError("from next"); }, return() { log.push("return is called"); return {}; } }; } },
        "a done that throws": { [Symbol.iterator]() { return { next() { return { get done() { throw new EvalError("from done"); } }; }, return() { log.push("return is called"); return {}; } }; } },
        "a value that throws": { [Symbol.iterator]() { return { next() { return { done: false, get value() { throw new EvalError("from value"); } }; }, return() { log.push("return is called"); return {}; } }; } },
        "a getter for next that throws": { [Symbol.iterator]() { return { get next() { throw new EvalError("from the getter of next"); } }; } },
        "results that are functions": { [Symbol.iterator]() { let turn = 0; return { next() { return Object.assign(() => {}, { done: turn++ > 0, value: "of a function" }); } }; } },
        "a done that is a text": { [Symbol.iterator]() { let turn = 0; return { next() { return { done: turn++ ? "yes" : "", value: "once" }; } }; } },
    }))
        tell(title + " of " + what, () => walk(thing));
}

// Iterators of the engine, as they are and changed.
tell("keys of a map", () => all(new Map([["a", 1], ["b", 2]]).keys()));
tell("entries of a map", () => all(new Map([["a", 1]]).entries()));
tell("values of a set", () => all(new Set([1, 2]).values()));
tell("entries of a list", () => all(["x", "y"].entries()));
tell("keys of a list with a hole", () => all([, "y"].keys()));
tell("values of a list that grows", () => { const list = [1]; const seen = []; for (const item of list.values()) { seen.push(item); if (list.length < 3) list.push(item + 1); } return seen.join(); });
tell("a text's iterator", () => all("a\u{1F600}b"[Symbol.iterator]()));
tell("matches", () => all("a1b2".matchAll(/\d/g)));
tell("an iterator helper", () => all([1, 2, 3].values().map((item) => item * 2).filter((item) => item > 2)));
tell("arguments", () => (function () { return all(arguments); })(1, 2));
tell("a typed array's values", () => all(new Uint8Array([1, 2]).values()));
tell("a map's iterator with a next of its own", () => { const keys = new Map([["a", 1]]).keys(); keys.next = () => ({ done: true }); return all(keys); });
tell("a set's iterator stepped before", () => { const values = new Set([1, 2, 3]).values(); values.next(); return all(values); });
tell("a list's iterator that has ended", () => { const values = [1].values(); all(values); return all(values) + "|"; });
tell("a list's iterator with return", () => { const values = [1, 2].values(); values.return = () => { log.push("return is called"); return {}; }; return firstOf(values); });
tell("a map changed while it is iterated", () => { const map = new Map([["a", 1], ["b", 2]]); const seen = []; for (const key of map.keys()) { seen.push(key); map.delete("b"); map.set("c", 3); } return seen.join(); });
