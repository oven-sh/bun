// A generator that goes over the names of an object, stepped by hand: each step takes the next name, and the loop ends behind the last one.
function* names(of) { for (const name in of) yield name; }
function* pairs(of) { for (const name in of) { yield name; yield of[name]; } yield "end"; }
function* twice(of) { for (const name in of) yield name; for (const name in of) yield of[name]; }
function* nested(of) { for (const name in of) for (const other in of) yield name + other; }
function* written() { for (const name in { p: 1, q: 2, r: 3 }) yield name; }
function* places() { for (const place in ["a", "b", "c", "d"]) yield place; }
function* some(of) { for (const name in of) { if (name === "y" || name === "1") continue; yield name; } }
function* joined(of) { let text = ""; for (const name in of) { text += name; yield text; } return text; }
let left = 0;
function* closing(of) { for (const name in of) { try { yield name; } finally { left++; } } }
function* asking(of) { for (const name in of) { const sent = yield name; if (sent === 3) yield "three"; } }
function* texts(of) { const list = []; for (const name in of) list.push(name + of[name]); for (const at in list) yield list[at]; }
function* growing(of) { for (const name in of) { if (name.length < 3) of[name + name] = 1; yield name; } }

function byWhile(generator) { const taken = []; let step = generator.next(); while (!step.done && taken.length < 30) { taken.push(step.value); step = generator.next(); } return taken; }
const lists = [];
function run(of) {
    {
        const it = names(of), taken = []; let step = it.next();
        while (!step.done && taken.length < 30) { taken.push(step.value); step = it.next(); }
        lists.push("names " + taken);
    }
    {
        const it = pairs(of), taken = [];
        for (let step = it.next(); !step.done; step = it.next()) { taken.push(step.value); if (taken.length > 30) break; }
        lists.push("pairs " + taken);
    }
    {
        const it = twice(of), taken = []; let step = it.next();
        while (!step.done && taken.length < 30) { taken.push(step.value); step = it.next(); }
        lists.push("twice " + taken);
    }
    {
        const it = nested(of), taken = []; let step = it.next();
        while (!step.done && taken.length < 30) { taken.push(step.value); step = it.next(); }
        lists.push("nested " + taken);
    }
    {
        const it = some(of), taken = []; let step = it.next();
        while (!step.done && taken.length < 30) { taken.push(step.value); step = it.next(); }
        lists.push("some " + taken);
    }
    {
        const it = joined(of), taken = []; let step = it.next();
        while (!step.done && taken.length < 30) { taken.push(step.value); step = it.next(); }
        lists.push("joined " + taken + " " + step.value);
    }
    {
        const it = closing(of), taken = []; let step = it.next();
        while (!step.done && taken.length < 30) { taken.push(step.value); step = it.next(); }
        lists.push("closing " + taken + " " + left);
    }
    {
        const it = asking(of), taken = []; let step = it.next("first");
        while (!step.done && taken.length < 30) { taken.push(step.value); step = it.next(taken.length); }
        lists.push("asking " + taken);
    }
    {
        const it = texts(of), taken = [];
        for (let step = it.next(); !step.done; step = it.next()) { taken.push(step.value); if (taken.length > 30) break; }
        lists.push("texts " + taken);
    }
    {
        const it = growing({ ...of }), taken = []; let step = it.next();
        while (!step.done && taken.length < 30) { taken.push(step.value); step = it.next(); }
        lists.push("growing " + taken);
    }
    lists.push("handed " + byWhile(names(of)) + " " + byWhile(pairs(of)));
}
function literals() {
    const it = written(), taken = []; let step = it.next();
    while (!step.done && taken.length < 30) { taken.push(step.value); step = it.next(); }
    const other = places();
    for (let step = other.next(); !step.done; step = other.next()) { taken.push(step.value); if (taken.length > 30) break; }
    lists.push("literals " + taken);
}
for (const of of [["k", "l", "m"], { x: 1, y: 2, z: 3 }, [], {}, "text", JSON.parse('{"a":[1],"b":null,"c":{"d":1}}'), Object.create({ above: 1 }, { own: { value: 2, enumerable: true } }), null, undefined, 5, new Uint8Array([7, 8, 9])])
    run(of);
literals();
const it = names({ p: 1, q: 2, r: 3 });
let count = 0;
for (let step = it.next(); !step.done; step = it.next()) { lists.push(step.value); if (count++ > 5) break; }
for (const line of lists) console.log(line);
