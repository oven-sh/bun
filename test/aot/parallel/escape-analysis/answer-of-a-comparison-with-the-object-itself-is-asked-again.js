// `const same = alias === object` while the object is not built yet, and `same` is asked in a later block: once behind a branch on data, twice, three times, in a loop.
const first = {}; const sameAtTopLevel = { t: first }.t === first; first.a = sameAtTopLevel ? 1 : 2; first.b = sameAtTopLevel ? 3 : 4; console.log(first.a, first.b);
class Tree { constructor(label) { this.label = label; this.parent = this; const isRoot = this.parent === this; this.depth = isRoot ? 0 : 1; this.kind = isRoot ? "root" : "child"; } }
console.log(new Tree("a").depth + ":" + new Tree("b").kind);
function once(n) { const o = { a: 0 }; const same = { t: o }.t === o; if (n < -100) return -1; if (same) o.a = 1; return o.a; }
function onceByField(n) { const o = { a: 0, me: null }; o.me = o; const same = o.me === o; if (n < -100) return -1; if (same) o.a = 1; return o; }
console.log(once(process.argv.length), onceByField(process.argv.length).a);
class Given { constructor(parent) { this.parent = parent ?? this; const isRoot = this.parent === this; this.depth = isRoot ? 0 : 1; this.kind = isRoot ? "root" : "child"; } }
console.log(new Given().kind, new Given(new Given()).kind, new Given().depth, new Given(new Given()).depth);
function throughAnotherObject() {
    const o = {};
    const same = { t: o }.t === o;
    o.a = same ? 1 : 2;
    o.b = same ? 3 : 4;
    return o;
}
class Node {
    constructor(label) {
        this.label = label;
        this.parent = this;
        const isRoot = this.parent === this;
        this.depth = isRoot ? 0 : 1;
        this.kind = isRoot ? "root" : "child";
    }
}
function behindBranchOnData(n) {
    const o = { a: 0, self: null };
    o.self = o;
    const same = o.self === o;
    if (n < -100)
        return -1;
    if (same)
        o.a = 1;
    return o.a;
}
function behindLoop(n) {
    const o = { a: 0, self: null };
    o.self = o;
    const same = o.self === o;
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += same ? 1 : 100;
    o.a = same ? sum : -sum;
    return o;
}
function notSame(n) {
    const o = { a: 0, self: null }, p = { a: 0, self: null };
    o.self = n > 1e9 ? o : p;
    const same = o.self === o;
    o.a = same ? 1 : 2;
    p.a = same ? 3 : 4;
    return [o.a, p.a];
}
function threeUses() {
    const o = { self: null, a: 0, b: 0, c: 0 };
    o.self = o;
    const different = o.self !== o;
    o.a = different ? 1 : 2;
    o.b = different ? 3 : 4;
    o.c = different ? 5 : 6;
    return o;
}
for (let turn = 0; turn < 3; turn++) {
    const a = throughAnotherObject(), b = new Node("x"), c = behindLoop(turn + 2), d = threeUses();
    console.log(a.a, a.b, b.depth + ":" + b.kind, behindBranchOnData(turn), c.a, notSame(turn).join(), d.a, d.b, d.c);
}
