// A return that is laid on what generators inherit while a loop over one runs: by the body, by a callee, through a generator that was kept, by built-ins, on a method's generators, where the body throws.
const notes = [];
const own = text => function () { notes.push(text); return {}; };
function* steps(limit) { for (let i = 0; i < limit; i++) yield i; }
class Source { *steps(limit) { for (let i = 0; i < limit; i++) yield i; } }
const source = new Source(), kept = steps(2), above = Object.getPrototypeOf(kept);
function put() { steps.prototype.return = own("callee"); }
function byBody() { let n = 0; for (const v of steps(3)) { steps.prototype.return = own("body"); if (++n === 2) break; } return n; }
function byCallee() { let n = 0; for (const v of steps(3)) { put(); if (++n === 2) break; } return n; }
function byKept() { let n = 0; for (const v of steps(3)) { above.return = own("kept"); if (++n === 2) break; } return n; }
function byDefinition() { let n = 0; for (const v of steps(3)) { Object.defineProperty(steps.prototype, "return", { value: own("defined"), configurable: true }); if (++n === 2) break; } return n; }
function byAssign() { let n = 0; for (const v of steps(3)) { Object.assign(steps.prototype, { return: own("assigned") }); if (++n === 2) return n; } return -1; }
function ofMethod() { let n = 0; for (const v of source.steps(3)) { Source.prototype.steps.prototype.return = own("method"); if (++n === 2) break; } delete Source.prototype.steps.prototype.return; return n; }
function thrown() { let n = 0; try { for (const v of steps(3)) { steps.prototype.return = own("thrown"); if (++n === 2) throw new Error("out"); } } catch (e) { notes.push(e.message); } return n; }
function toTheEnd() { let n = 0; for (const v of steps(3)) { steps.prototype.return = own("end"); n += v; } return n; }
function plainly() { let n = 0; for (const v of steps(5)) { if (++n === 2) break; } return n; }
for (let call = 0; call < 3; call++) {
  for (const run of [byBody, byCallee, byKept, byDefinition, byAssign, ofMethod, thrown, toTheEnd, plainly]) {
    notes.length = 0;
    const answer = run();
    console.log(run.name, answer, notes.join());
    delete steps.prototype.return;
  }
}
console.log([...kept].join());
