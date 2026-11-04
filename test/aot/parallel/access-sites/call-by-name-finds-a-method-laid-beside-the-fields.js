// `object.run(a)`, where a store by name has laid `run` on a compiled object beside its fields, and objects of many Structures come to one place: the place holds two answers, so most calls go on by the tables.
// The stores run in text that the build has not seen, so no layout has a slot for what they add.
// What stands behind the call keeps it from being the last thing that the caller does: a call in that position is a read and a jump.
let calls = 0;
const callers = [];
callers.push((o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; });
callers.push((o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; });
callers.push((o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; });
callers.push((o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; });
class Plain { constructor(k) { this.k = k; } }
class WithMethod { constructor(k) { this.k = k; } run(a) { return "of the class " + (a + this.k); } }
const makers = [k => new Plain(k), k => ({ k }), k => ({ k, other: 1 }), k => new WithMethod(k)];
console.log(new Function("callers", "makers", `
    const lines = [];
    let next = 0;
    const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
    function plus(a) { return a + this.k; }
    function minus(a) { return a - this.k; }
    // Names in front of it, of which there are \`kinds\` sets: so many Structures.
    const lay = (o, turn, kinds, names, run) => { for (let i = 0; i < names; i++) o["x" + (turn % kinds) + "n" + i] = i; o.run = run; return o; };
    const kept = [];
    for (let i = 0; i < 8; i++) kept.push(lay(makers[i % 3](i), i, 8, 2, plus));
    for (const names of [1, 12]) for (const maker of makers) {
        const steps = [
            [i => lay(maker(1), i, 1, names, plus), () => { }],
            [i => lay(maker(2), i, 9, names, i % 2 ? plus : minus), () => { }],
        ];
        for (const [make, step] of steps) {
            const run = callers[next++ % callers.length];
            let before;
            for (let turn = 0; turn < 600; turn++) before = attempt(() => run(make(turn), turn));
            lines.push(names + " " + before);
        }
    }
    const changes = [
        o => { o.run = minus; },
        o => { delete o.run; },
        o => { o.run = 5; },
        o => { Object.defineProperty(o, "run", { get() { return a => "from a getter " + a; }, configurable: true }); },
        o => { for (let i = 0; i < 40; i++) o["more" + i] = i; },
        o => { Object.freeze(o); },
        o => { delete o.x6n0; },
        o => { Object.setPrototypeOf(o, { run(a) { return "above " + a; } }); delete o.run; },
    ];
    const run = callers[next++ % callers.length];
    let all = "";
    for (let turn = 0; turn < 1600; turn++) all = attempt(() => run(kept[turn % 8], turn));
    lines.push(all);
    changes.forEach((change, i) => change(kept[i]));
    for (let i = 0; i < 8; i++) lines.push(i + " " + attempt(() => run(kept[i], 100)));
    for (let turn = 0; turn < 1600; turn++) all = attempt(() => run(kept[turn % 8], turn));
    for (let i = 0; i < 8; i++) lines.push(i + " " + attempt(() => run(kept[i], 200)));
    return lines.join("\\n");
`)(callers, makers));
console.log(calls);
