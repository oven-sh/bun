const rounds = +process.argv[2] || 40;
const ring = [null, null, null, null, null, null, null, null];
function makeDial(start, loud) { let at = start; return Object.freeze({ first() { return ++at; }, second() { return at + 1; }, third() { return at + 2; }, fourth() { return at + 3; }, fifth() { return at + 4; }, sixth() { return at + 5; }, mode: loud ? "loud" : "quiet" }); }
for (let t = 0; t < rounds; t++) ring[t & 7] = makeDial(t, (t & 1) === 0);
const last = ring[(rounds - 1) & 7];
console.log("SAID", last.first(), last.sixth(), last.mode, Object.isFrozen(last));
