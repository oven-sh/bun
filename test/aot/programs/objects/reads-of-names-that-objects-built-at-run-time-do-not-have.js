// Objects built key by key, and literals that got properties outside their layouts, are read hundreds of times under names they do not have, and then get them in every way there is.
const lines = [];
function say(what, value) { lines.push(what + " " + value); }
function read(o) { return o.late; }
function readMany(o) { return [o.late, o.later, o.latest, o.toString === Object.prototype.toString, typeof o.constructor, o.first, o.second].join(); }
const names = "first second third fourth fifth sixth".split(" ");
function build(mask) { const o = {}; for (let i = 0; i < names.length; i++) if (mask >> i & 1) o[names[i]] = i; return o; }
function literalWithExtras(index) {
    const o = [{ a: 1 }, { b: 2, c: 3 }, { first: "own", d: 4 }][index % 3];
    const copy = { ...o };
    copy["extra" + index % 5] = index;
    o["extra" + index % 5] = index;
    return index & 1 ? o : copy;
}
function hammer(make, work) { const seen = new Set(); for (let round = 0; round < 400; round++) seen.add(work(make(round))); return [...seen].sort().join(" | "); }
say("built key by key", hammer(round => build(round % 64), readMany));
say("literals with extras", hammer(literalWithExtras, readMany));

for (const [kind, make] of [["built", () => build(5)], ["with extras", () => literalWithExtras(3)], ["with extras, a copy", () => literalWithExtras(4)]]) {
    const one = make();
    for (let round = 0; round < 200; round++) read(one);
    say(kind + ": nothing", read(one));
    one.late = 1; say(kind + ": stored", read(one));
    delete one.late; say(kind + ": deleted", read(one));
    for (let round = 0; round < 200; round++) read(one);
    one["la" + "te"] = 2; say(kind + ": stored by key", read(one));
    delete one.late;
    Object.defineProperty(one, "late", { get() { return "got"; }, configurable: true }); say(kind + ": a getter", read(one));
    delete one.late;
    for (let round = 0; round < 200; round++) read(one);
    const above = { late: "above" };
    Object.setPrototypeOf(one, above); say(kind + ": another prototype", read(one));
    delete above.late; say(kind + ": which loses it", read(one));
    for (let round = 0; round < 200; round++) read(one);
    above.late = "again"; say(kind + ": and gets it again", read(one));
    Object.setPrototypeOf(one, Object.prototype); say(kind + ": back", read(one));
    Object.setPrototypeOf(one, null); say(kind + ": no prototype", read(one) + " " + one.toString);
    const twin = make();
    for (let round = 0; round < 200; round++) read(twin);
    Object.assign(twin, { late: "assigned" }); say(kind + ": assigned", read(twin));
    const frozen = Object.freeze(make());
    for (let round = 0; round < 200; round++) read(frozen);
    say(kind + ": frozen", read(frozen));
}

// Many properties make a dictionary of it, which lists nothing for certain.
const large = {};
for (let i = 0; i < 300; i++) large["key" + i] = i;
for (let round = 0; round < 200; round++) read(large);
say("a large object", read(large)); large.late = "there"; say("a large object, stored", read(large)); delete large.late; say("a large object, deleted", read(large));
const emptied = build(63); for (const name of names) delete emptied[name];
for (let round = 0; round < 200; round++) read(emptied);
say("emptied", read(emptied)); emptied.late = 3; say("emptied, stored", read(emptied));

// The numbers of Structures are given out again behind a collection.
for (let cycle = 0; cycle < 4; cycle++) {
    const batch = [];
    for (let i = 0; i < 200; i++) { const o = {}; o["unique" + cycle + "x" + i] = i; if (i % 3 === 0) o.late = i; batch.push(o); }
    let sum = 0;
    for (let round = 0; round < 3; round++) for (const o of batch) sum += read(o) ?? -1;
    say("cycle " + cycle, sum);
    Bun.gc(true);
}
console.log(lines.join("\n"));
