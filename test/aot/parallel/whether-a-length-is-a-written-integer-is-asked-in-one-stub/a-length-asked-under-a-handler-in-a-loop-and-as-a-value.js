let counted = 0;
globalThis.askers = {
    underHandler(thing) { try { if (thing.length === 0) return "empty"; return "filled"; } catch (error) { return error.constructor.name; } finally { counted++; } },
    inLoop(things) { let empty = 0; for (const thing of things) { if (thing.length === 0) empty++; } return empty; },
    asValue(thing) { const same = thing.length === 1; return same; },
    twice(thing) { const length = thing.length; if (length === 2) return length + 1; return length; },
    both(left, right) { if (left.length === 0 && right.length === 0) return "both"; if (left.length === 0 || right.length === 1) return "either"; return "neither"; },
    chained(thing) { return thing.length === 0 ? "none" : thing.length === 1 ? "one" : thing.length === 2 ? "two" : "many"; },
    throwing(thing) { if (thing.length === 3) return 1; return 0; },
};
const bomb = { get length() { throw new RangeError("made up"); } };
const things = [[], [1], "", "ab", { length: 0 }, new Uint8Array(0), [1, 2, 3]];
for (let round = 0; round < 200; round++) {
    const { underHandler, inLoop, asValue, twice, both, chained, throwing } = globalThis.askers;
    let line = "";
    for (const thing of things) line += underHandler(thing) + asValue(thing) + twice(thing) + chained(thing) + " ";
    line += underHandler(null) + underHandler(bomb) + inLoop(things) + both([], "") + both([], [1]) + both([1], [2]) + both("a", "bc");
    try { throwing(bomb); line += "no"; } catch (error) { line += error.message; }
    try { throwing(undefined); line += "no"; } catch (error) { line += error.constructor.name; }
    try { chained(null); line += "no"; } catch (error) { line += error.constructor.name; }
    if (round % 67 === 0) console.log(line);
}
console.log(counted);
