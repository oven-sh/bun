// `object.run(a)`: the place remembers where the callee lies, never the callee.
// EACH PLACE IS WARMED ON ITS OWN: every step has callers of its own, each of which is one place, asked 400 times before anything changes. A caller shared by all steps backs off and is filled no more.
// The steps run in text that the build has not seen, so nothing is known of what a caller is handed and no caller is copied into its caller.
class A { constructor(k) { this.k = k; } run(a) { return a + this.k; } stop(a) { return "A stops " + a; } }
class B { constructor(k) { this.j = "j"; this.k = k; } run(a) { return a - this.k; } stop(a) { return "B stops " + a; } }
class Wide { } for (let i = 0; i < 40; i++) Wide.prototype["m" + i] = function (a) { return a * i; };
Wide.prototype.run = function (a) { return "wide" + a; };
Wide.prototype.stop = function (a) { return "wide stops" + a; };
const callers = [(o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }, (o, a) => { const r = o.run(a); return r; }, (o, a) => { const r = o.stop(a); return r; }];
console.log(new Function("callers", "A", "B", "Wide", `
    const lines = [];
    let next = 0;
    const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
    const steps = [
        [i => new A(1), () => { }],
        [i => new B(1), () => { }],
        [i => i % 2 ? new A(2) : new B(2), () => { }],
        [i => new Wide(), () => { Wide.prototype.run = a => "wide replaced" + a; }],
        [i => ({ run(a) { return "literal" + a; }, stop(a) { return "literal stops" + a; } }), () => { }],
        [i => { const o = new A(3); o.run = a => "own" + a; return o; }, () => { }],
        [i => new A(4), () => { A.prototype.run = function (a) { return "replaced" + a + this.k; }; }],
        [i => new A(5), () => { delete A.prototype.run; }],
        [i => new A(5), () => { A.prototype.run = 5; }],
        [i => new A(6), () => { Object.defineProperty(A.prototype, "run", { get() { return a => "from a getter" + a; }, configurable: true }); }],
        [i => new A(7), () => { delete A.prototype.run; Object.setPrototypeOf(A.prototype, { run(a) { return "above" + a; } }); }],
        [i => new A(8), () => { A.prototype.stop = a => "stops otherwise " + a; }],
        [i => new B(9), () => { Object.setPrototypeOf(B.prototype, { }); delete B.prototype.stop; }],
    ];
    for (const [make, step] of steps) {
        const run = callers[next++], stop = callers[next++];
        let before;
        for (let turn = 0; turn < 400; turn++) before = attempt(() => run(make(turn), turn)) + " " + attempt(() => stop(make(turn), turn));
        step();
        lines.push(before + " > " + attempt(() => run(make(1), 1)) + " " + attempt(() => stop(make(1), 1)));
        for (let turn = 0; turn < 400; turn++) before = attempt(() => run(make(turn), turn)) + " " + attempt(() => stop(make(turn), turn));
        lines.push(before);
    }
    {
        const run = callers[next++], stop = callers[next++];
        const holder = new B(8);
        let wrong = 0;
        for (let turn = 0; turn < 400; turn++) { holder.run = turn % 2 ? a => "odd" : a => "even"; if (run(holder, 0) !== (turn % 2 ? "odd" : "even")) wrong++; }
        lines.push(wrong);
    }
    {
        // What cannot be filed comes last: a fill that fails makes the places beside it wait longer.
        const run = callers[next++];
        for (const receiver of [new Map(), [1], "text", 5, 5n, true, Symbol.iterator, null, undefined, Object.create(null), () => 1]) lines.push(attempt(() => run(receiver, 1)));
        lines.push(attempt(() => run({ run: undefined }, 1)) + " " + attempt(() => run({ run: null }, 1)) + " " + run({ run: Math.abs }, -3) + " " + run({ run: String.prototype.trim.call.bind(String.prototype.trim) }, " x "));
    }
    return lines.join("\\n");
`)(callers, A, B, Wide));
