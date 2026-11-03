// Flags: --aot-disable=flow-results
// A trace that is taken in the callback of an array method names the method, also where the compiler runs a chain of methods as one loop.
const names = e => String(e.stack).split("\n").slice(1, 6).map(l => l.trim().replace(/\(?[^ (]*[\\/]/, "(")).join(" < ");
function take(x) { if (x > 1) throw new Error("x"); return true; }
const cases = {
  filterLength() { const n = [1, 2].filter(take).length; return n; },
  mapLength() { const n = [1, 2].map(take).length; return n; },
  filterSome() { const n = [1, 2].filter(take).some(x => x > 5); return n; },
  filterEvery() { const n = [1, 2].filter(take).every(x => x > 5); return n; },
  filterMap() { const n = [1, 2].filter(x => x > 0).map(take); return n; },
  mapFilterLength() { const n = [1, 2].map(x => x + 1).filter(take).length; return n; },
  filterMapLength() { const n = [1, 2].filter(take).map(x => x + 1).length; return n; },
  filterForEach() { [1, 2].filter(x => x > 0).forEach(take); return 1; },
  filterReduce() { const n = [1, 2].filter(take).reduce((a, b) => a + b, 0); return n; },
  filterJoin() { const n = [1, 2].filter(take).join(","); return n; },
  filterFind() { const n = [1, 2].filter(x => x > 0).find(take); return n; },
  filterFindIndex() { const n = [1, 2].filter(take).findIndex(x => x > 5); return n; },
  mapFlatMap() { const n = [1, 2].map(take).flatMap(x => [x]); return n; },
  some() { const n = [1, 2].some(x => !take(x)); return n; },
};
for (const name of Object.keys(cases)) { try { cases[name](); console.log(name, "did not throw"); } catch (e) { console.log(name, names(e)); } }
