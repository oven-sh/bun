// A place that reads under a name remembers what it found last. What it remembers of compiled objects must not be asked of any other cell, and an empty place answers for nothing.
// EACH PLACE IS WARMED ON ITS OWN: every step has a reader of its own, which is one place, asked 400 times before anything changes. A reader shared by all steps backs off and is filled no more.
// The steps run in text that the build has not seen, so nothing is known of what a reader is handed and no reader is copied into its caller.
// A place answers by shape for a slot that holds any value: the fields hold texts.
// Two classes have the names, so nothing is expected of whoever is read under them, and the read has a place.
class Point { constructor(x) { this.x = "x" + x; this.y = "y" + x; } get() { return this.x; } }
class Turned { constructor(x) { this.first = 1; this.y = "turned y" + x; this.x = "turned x" + x; } }
const readers = [o => o.x, o => o.y, o => o.x, o => o.y, o => o.x, o => o.y];
const sizes = [o => o.size, o => o.x, o => o.size, o => o.x];
console.log(new Function("readers", "sizes", "Point", "Turned", `
    const lines = [];
    const others = () => [Object.create(Point.prototype), Object.create(null), new Map(), new Set([1]), /a/g, function f() { }, () => 1, [1, 2], "text", 10n, Symbol("s"), new Date(0), new Uint8Array(2), Promise.resolve(1), new WeakMap(), new Error("e"), 5, true, { x: "plain x", y: "plain y" }, { y: 1, x: 2, size: 3 }, new Proxy({ }, { get(target, key) { return "proxy " + String(key); } })];
    const show = value => typeof value === "function" ? "function" : String(value);
    {
        // Filled by objects of the class, then asked for the others.
        const readX = readers[2], readY = readers[3];
        let last;
        for (let turn = 0; turn < 400; turn++) last = readX(new Point(turn)) + readY(new Point(turn));
        lines.push(last);
        lines.push(others().map(o => show(readX(o)) + "|" + show(readY(o))).join());
        lines.push(readX(new Point(7)) + " " + readY(new Point(7)) + " " + readX(new Turned(8)) + " " + readY(new Turned(8)));
    }
    {
        // Filled by a Map, then asked for the others.
        const readSize = sizes[0], readX = sizes[1];
        let sum = 0;
        for (let turn = 0; turn < 400; turn++) sum += readSize(new Map([[turn, turn]])) + (readX(new Map()) === undefined ? 1 : 0);
        lines.push(sum + " " + others().map(o => show(readSize(o))).join());
        lines.push(readSize(new Point(7)) + " " + readX(new Point(7)));
    }
    {
        // In turns.
        const readX = readers[4], readY = readers[5];
        let wrong = 0;
        for (let turn = 0; turn < 400; turn++) {
            if (readX(new Point(turn)) !== "x" + turn || readY(new Point(turn)) !== "y" + turn) wrong++;
            if (readX(new Turned(turn)) !== "turned x" + turn || readY(new Turned(turn)) !== "turned y" + turn) wrong++;
            for (const o of others().slice(0, 18)) if (readX(o) !== undefined || readY(o) !== undefined) wrong++;
        }
        lines.push(wrong);
    }
    {
        // The places are empty. A fill that fails makes the places beside it wait longer, so what cannot be filed comes behind all that is warmed.
        const [readX, readY] = readers;
        lines.push(others().map(o => show(readX(o)) + "|" + show(readY(o))).join());
        lines.push(Object.create(Point.prototype).get());
    }
    return lines.join("\\n");
`)(readers, sizes, Point, Turned));
