// The steps of an async generator: what its body does, who asks it for the next step and how, how old it is, and where the asker stands. Each program prints the order in which everything
// happened; a chain of awaits runs beside it and says which turn it is. That order is the language's. It must not hang on whether the generator has lived through a collection, nor on which of two
// implementations takes a step: compiled code leaves for the engine's own where a store needs a write barrier, so every program also runs with the barrier always needed.
export const alsoUnder = [{ BUN_JSC_forceFencedBarrier: "1" }];

export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const bodies: Record<string, string> = {
    plain: 'yield 1; yield 2; return 3;',
    yieldsPromise: 'yield Promise.resolve(1); yield 2;',
    yieldsLater: 'yield new Promise(r => queueMicrotask(() => r(1))); yield 2;',
    yieldsThenable: 'yield { then(r) { say("then read"); r(1); } }; yield 2;',
    yieldsRejected: 'yield 1; yield Promise.reject(new Error("no")); yield 3;',
    awaits: 'await null; yield 1; await null; await null; yield 2;',
    throwsLate: 'yield 1; throw new Error("the end");',
    throwsFirst: 'throw new Error("the end"); yield 1;',
    returnsPromise: 'yield 1; return Promise.resolve(9);',
    returnsRejected: 'yield 1; return Promise.reject(new Error("no"));',
    finallyAwaits: 'try { yield 1; yield 2; } finally { await null; say("finally"); }',
    finallyYields: 'try { yield 1; yield 2; } finally { yield "f"; say("behind f"); }',
    finallyReturns: 'try { yield 1; yield 2; } finally { return "from finally"; }',
    catches: 'try { yield 1; yield 2; } catch (e) { say("inside caught " + e.message); yield "c"; }',
    delegates: 'yield* (async function* () { yield 1; await null; yield 2; return "inner"; })(); yield 3;',
    delegatesToList: 'yield* [1, Promise.resolve(2)]; yield 3;',
    delegatesToOwn: 'yield* { [Symbol.asyncIterator]() { let n = 0; return { next() { say("own next"); return Promise.resolve({ value: ++n, done: n > 2 }); }, return(v) { say("own return"); return Promise.resolve({ value: v, done: true }); } }; } }; yield 3;',
    takes: 'const a = yield 1; say("took " + a); const b = yield 2; say("took " + b);',
    reenters: 'yield 1; started.push(loop(self, 0)); started.push(byCall(self)); say("started"); throw new Error("the end");',
    reentersAndGoesOn: 'yield 1; started.push(byCall(self)); say("started"); yield 2; started.push(byCall(self)); yield 3;',
    empty: '',
  };
  const askers: Record<string, string> = {
    byHand: 'await byHand(g, 4);',
    twoAtOnce: 'const a = g.next(), b = g.next(); note("a", a); note("b", b); await settle(a, b); await byHand(g, 2);',
    threeAtOnce: 'const a = g.next(), b = g.next(), c = g.next(); note("a", a); note("b", b); note("c", c); await settle(a, b, c);',
    loop: 'await loop(g, 0);',
    loopBreaks: 'try { for await (const v of g) { say("loop got " + show(v)); break; } say("left"); } catch (e) { say("loop caught " + e.message); } await byHand(g, 1);',
    loopAndHand: 'const l = loop(g, 0); await byHand(g, 2); await l;',
    twoLoops: 'const l = loop(g, 0), m = loop(g, 1); await l; await m;',
    returnsBehindOne: 'await byHand(g, 1); note("return", g.return("r")); await byHand(g, 2);',
    returnsFirst: 'note("return", g.return("r")); await byHand(g, 2);',
    returnsPromise: 'await byHand(g, 1); note("return", g.return(Promise.resolve("r"))); await byHand(g, 2);',
    throwsBehindOne: 'await byHand(g, 1); note("throw", g.throw(new Error("in"))); await byHand(g, 2);',
    throwsFirst: 'note("throw", g.throw(new Error("in"))); await byHand(g, 2);',
    nextReturnNext: 'const a = g.next(), b = g.return("r"), c = g.next(); note("a", a); note("b", b); note("c", c); await settle(a, b, c);',
    nextThrowNext: 'const a = g.next(), b = g.throw(new Error("in")), c = g.next(); note("a", a); note("b", b); note("c", c); await settle(a, b, c);',
    thens: 'await new Promise(done => { g.next().then(s => { say("first " + step(s)); return g.next(); }).then(s => { say("second " + step(s)); return g.next(); }).then(s => { say("third " + step(s)); done(); }, e => { say("failed " + e.message); done(); }); });',
    hands: 'await byHand(g, 1, "x"); await byHand(g, 3, "y");',
    racing: 'const w = await Promise.race([g.next(), g.next()]).then(step, e => "failed " + e.message); say("won " + w); await byHand(g, 2);',
  };
  const ages: Record<string, [string, string]> = { fresh: ['', ''], old: ['Bun.gc(true);', ''], oldBehindOne: ['', 'Bun.gc(true);'] };
  const head = `const lines = [], started = [];
const say = t => { lines.push(t); };
const show = v => (v === undefined ? "undefined" : typeof v === "object" && v !== null ? (typeof v.then === "function" ? "a thenable" : JSON.stringify(v)) : String(v));
const step = s => show(s.value) + " " + s.done;
const note = (name, p) => { p.then(s => say(name + " got " + step(s)), e => say(name + " failed " + e.message)); };
const settle = (...l) => Promise.allSettled(l);
const loop = async (g, w) => { try { for await (const v of g) say("loop " + w + " got " + show(v)); say("loop " + w + " ends"); } catch (e) { say("loop " + w + " caught " + e.message); } };
const byCall = async g => { try { const s = await g.next(); say("call got " + step(s)); } catch (e) { say("call caught " + e.message); } };
async function byHand(g, steps, given) { for (let i = 0; i < steps; i++) { try { const s = await g.next(given); say("hand got " + step(s)); } catch (e) { say("hand caught " + e.message); } AGE } }
async function busy(n) { for (let i = 0; i < n; i++) { await null; say("turn " + i); } }
let self;
`;
  for (const [b, body] of Object.entries(bodies))
    for (const [a, asker] of Object.entries(askers))
      for (const [age, [before, between]] of Object.entries(ages))
        for (const place of ["top", "inside", "method"]) {
          const make = place === "method" ? `new (class C { async *m() { ${body} } })().m()` : `(async function* () { ${body} })()`;
          const run = `self = ${make}; const g = self; ${before}\nconst beside = busy(16);\n${asker}\nawait Promise.allSettled(started); await beside;`;
          const text =
            head.replace("AGE", between ? "if (i === 0) " + between : "") +
            (place === "top" ? run + "\n" : `async function main() {\n${run}\n}\nawait main();\n`) +
            'console.log(lines.join(" . "));\n';
          made.push({ name: `${b}-${a}-${age}-${place}`, file: "program.mjs", text });
        }
  return made;
}
