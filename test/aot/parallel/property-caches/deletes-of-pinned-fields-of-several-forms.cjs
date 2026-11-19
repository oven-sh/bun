// Classes, literals, constructor functions, accessors and sloppy deletions beside deletes-of-pinned-late-names.cjs, with several shares of pinned names.
const out = [];
{
    class A { constructor(i) { this.a = i; } }
    const make = (i) => { const o = new A(i); o.lateA = i; return o; }, before = (o) => { delete o.lateA; }, remove = (o) => delete o.lateA, pin = (o) => { Object.defineProperty(o, "lateA", { value: 5 }); };
    let gone = 0, kept = 0;
    for (let i = 0; i < 400; i++) { const o = make(i); before(o); if (i % 4 === 0) { pin(o); if (remove(o)) gone++; else kept++; if (!("lateA" in o)) gone += 1000; } }
    out.push(gone + " " + kept);
}
{
    const make = (i) => { const o = { b: i }; o.lateB = i; return o; }, before = (o) => { delete o.lateB; }, remove = (o) => delete o.lateB, pin = (o) => { Object.defineProperty(o, "lateB", { value: "t", enumerable: true }); };
    let gone = 0, kept = 0;
    for (let i = 0; i < 400; i++) { const o = make(i); before(o); if (i % 3 === 0) { pin(o); if (remove(o)) gone++; else kept++; if (!("lateB" in o)) gone += 1000; } }
    out.push(gone + " " + kept);
}
{
    function F(i) { this.f = i; }
    const make = (i) => { const o = new F(i); o.lateC = [i]; return o; }, before = (o) => { delete o.lateC; }, remove = (o) => delete o.lateC, pin = (o) => { Object.defineProperty(o, "lateC", { value: null, writable: true }); };
    let gone = 0, kept = 0;
    for (let i = 0; i < 400; i++) { const o = make(i); before(o); if (i % 3 === 0) { pin(o); if (remove(o)) gone++; else kept++; if (!("lateC" in o)) gone += 1000; } }
    out.push(gone + " " + kept);
}
{
    const make = (i) => { const o = { d: i }; o.lateD = i; return o; }, before = (o) => { delete o.lateD; }, remove = (o) => delete o.lateD, pin = (o) => { Object.defineProperty(o, "lateD", { get() { return 4; } }); };
    let gone = 0, kept = 0;
    for (let i = 0; i < 400; i++) { const o = make(i); before(o); if (i % 3 === 0) { pin(o); if (remove(o)) gone++; else kept++; if (!("lateD" in o)) gone += 1000; } }
    out.push(gone + " " + kept);
}
for (const share of [2, 3, 4, 5]) {
    class E { constructor(i) { this.e = i; this.k = "k"; } }
    const make = (i) => { const o = new E(i); if (i % 2) o.lateE = i; return o; }, before = (o) => { delete o.lateE; }, remove = (o) => delete o.lateE, pin = (o) => { Object.defineProperty(o, "lateE", { value: 5 }); };
    let gone = 0, kept = 0;
    for (let i = 0; i < 400; i++) { const o = make(i); before(o); if (i % share === 0) { pin(o); if (remove(o)) gone++; else kept++; if (!("lateE" in o)) gone += 1000; } }
    out.push(share + " " + gone + " " + kept);
}
console.log(out.join("\n"));
