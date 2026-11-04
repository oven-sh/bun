// `object.run(a)`, where `run` is a value of the object's own that lies in its butterfly: the place remembers by the Structure where the callee lies, never the callee.
// EACH PLACE IS WARMED ON ITS OWN: every step has a caller of its own, which is one place, asked 400 times before anything changes.
// The steps run in text that the build has not seen, so the objects are ordinary ones, nothing is known of what a caller is handed and no caller is copied into its caller.
// What stands behind the call keeps it from being the last thing that the caller does: a call in that position is a read and a jump.
let calls = 0;
const callers = [];
callers.push((o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; });
callers.push((o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; });
callers.push((o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; });
callers.push((o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; });
callers.push((o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; }, (o, a) => { const r = o.run(a); calls++; return r; });
console.log(new Function("callers", `
    const lines = [];
    let next = 0;
    const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
    function plus(a) { return a + this.k; }
    function minus(a) { return a - this.k; }
    // Forty names go in front, so that "run" lies out of line.
    const fill = (o, k, run, names = 40) => { for (let i = 0; i < names; i++) o["p" + i] = i; o.k = k; o.run = run; return o; };
    const wide = (k, run, names) => fill({ }, k, run, names);
    const one = [];
    for (let i = 0; i < 12; i++) one.push(wide(i, plus));
    const steps = [
        [i => wide(1, plus), () => { }],
        [i => wide(2, i % 2 ? plus : minus), () => { }],
        [i => i % 2 ? wide(3, plus, 40) : wide(3, minus, 41), () => { }],
        [i => i % 3 ? i % 3 == 1 ? wide(4, plus, 40) : wide(4, minus, 41) : wide(4, plus, 42), () => { }],
        [i => one[0], () => { one[0].run = minus; }],
        [i => one[1], () => { delete one[1].run; }],
        [i => one[2], () => { one[2].run = 5; }],
        [i => one[3], () => { for (let i = 0; i < 100; i++) one[3]["q" + i] = i; }],
        [i => one[4], () => { Object.defineProperty(one[4], "run", { get() { return a => "from a getter " + a; }, configurable: true }); }],
        [i => one[5], () => { delete one[5].run; Object.setPrototypeOf(one[5], { run(a) { return "above " + a; } }); }],
        [i => one[6], () => { Object.freeze(one[6]); attempt(() => { "use strict"; one[6].run = minus; }); }],
        [i => one[7], () => { one[7][0] = "element"; one[7][1000000] = "far element"; }],
        [i => one[8], () => { delete one[8].p3; one[8].run = minus; }],
        [i => fill([1, 2, 3], 5, plus), () => { }],
        [i => fill(() => 1, 6, minus), () => { }],
        [i => fill(new Map(), 7, plus), () => { }],
        [i => fill(Object.create(null), 8, minus), () => { }],
        [i => fill(Object.create({ run(a) { return "hidden " + a; } }), 9, plus), () => { }],
    ];
    for (const [make, step] of steps) {
        const run = callers[next++];
        let before;
        for (let turn = 0; turn < 400; turn++) before = attempt(() => run(make(turn), turn));
        step();
        lines.push(before + " > " + attempt(() => run(make(1), 1)) + " " + attempt(() => run(make(2), 2)));
        for (let turn = 0; turn < 400; turn++) before = attempt(() => run(make(turn), turn));
        lines.push(before);
    }
    {
        // The Structures die, and the numbers of those that come next may be theirs.
        const run = callers[next++];
        let sum = 0;
        for (let round = 0; round < 6; round++) {
            for (let turn = 0; turn < 400; turn++) sum += run(wide(round, round % 2 ? plus : minus, 40 + round), turn);
            Bun.gc(true);
        }
        lines.push(sum);
    }
    return lines.join("\\n");
`)(callers));
console.log(calls);
